// Spec: /specs/03_backend.md §4.4
// Spec: /specs/04_api_asaas.md §4.5 (cash out Pix externo)
// Fluxo: auth → validar PIN+segurança → verificar KYC/Pix/saldo →
//        Asaas cash out → taxa para conta pai → registrar TXs → audit

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { sha256hex, bcryptVerify, aesDecrypt, verifyPinWithPairs, tryParsePairsPayload } from '../_shared/crypto.ts'
import { normalizeCpf } from '../_shared/cpf.ts'
import { cashoutPix, transferToWallet, getSubcontaBalance, AsaasError } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'
import { resolveWalletContext } from '../_shared/company-permissions.ts'

interface DescarregarRequest {
  amount_albers: number
  pin_hash: string
  security_answer_hash: string
  company_id?: string
}

const MIN_AMOUNT     = 10
const MAX_ATTEMPTS   = 3
const WINDOW_MINUTES = 15

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

async function failedAttempts(userId: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('event_type', ['descarregar_pin_failed', 'descarregar_security_failed'])
    .gte('created_at', since)
  return count ?? 0
}

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Autenticar JWT ───────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Parse body ───────────────────────────────────────────────────────────────

  let body: DescarregarRequest
  try { body = await req.json() } catch (e) {
    await logError(supabaseAdmin, 'financial-descarregar', e, {})
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { amount_albers, pin_hash, security_answer_hash, company_id } = body
  const safePayload = { amount_albers, company_id } as Record<string, unknown>

  if (!amount_albers || !pin_hash || !security_answer_hash) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }
  if (typeof amount_albers !== 'number' || amount_albers < MIN_AMOUNT) {
    return err('INVALID_AMOUNT', `Valor mínimo: ${MIN_AMOUNT} Albers`, 400)
  }

  // ── Buscar dados do usuário ──────────────────────────────────────────────────
  // PIN e pergunta de segurança são sempre do usuário autenticado (o operador),
  // mesmo quando a operação atua sobre a carteira de uma empresa.

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, auth_id, asaas_api_key_enc, kyc_status, account_status, created_at, pix_key, pix_key_type, cpf')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (userErr || !user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Resolver carteira: pessoal ou empresa ─────────────────────────────────────

  const resolution = await resolveWalletContext(supabaseAdmin, user.id, company_id, 'descarregar', user)
  if (!resolution.ok) return err(resolution.code, resolution.message, resolution.status)
  const wallet = resolution.wallet

  // ── Verificar KYC obrigatório (spec §5.4) ────────────────────────────────────

  if (wallet.kycStatus !== 'approved') {
    return err('KYC_REQUIRED', 'Verificação de identidade necessária para descarregar', 403)
  }

  // ── Verificar chave Pix cadastrada ───────────────────────────────────────────
  // Empresas ainda não têm tela de configuração de chave Pix de saque nesta fase.

  if (!wallet.pixKey || !wallet.pixKeyType) {
    return err(
      wallet.ownerType === 'company' ? 'COMPANY_PIX_KEY_NOT_CONFIGURED' : 'PIX_KEY_MISSING',
      wallet.ownerType === 'company'
        ? 'Chave Pix da empresa ainda não configurada'
        : 'Chave Pix não cadastrada — configure em Perfil',
      422,
    )
  }

  // ── Verificar CPF da chave Pix = CPF do usuário (spec §5.4 — validação local) ─
  // Se a chave for do tipo CPF, o CPF da chave deve ser o mesmo titular da conta.
  // Só se aplica à carteira pessoal — chave CNPJ de empresa não tem esse checo ainda.

  if (wallet.ownerType === 'personal' && wallet.pixKeyType === 'CPF') {
    const pixCpfHash = await sha256hex(normalizeCpf(wallet.pixKey))
    if (pixCpfHash !== user.cpf) {
      return err('PIX_CPF_MISMATCH', 'Chave Pix CPF não corresponde ao titular da conta', 422)
    }
  }

  // ── Rate limiting (3 tentativas em 15 min) ───────────────────────────────────

  const attempts = await failedAttempts(user.id)
  if (attempts >= MAX_ATTEMPTS) {
    return err(
      'TOO_MANY_ATTEMPTS',
      `Operação bloqueada por ${WINDOW_MINUTES} minutos após tentativas excessivas`,
      429,
    )
  }

  // ── Verificar PIN (spec §6: SHA-256 em trânsito, bcrypt no banco) ────────────

  const { data: authMeta } = await supabaseAdmin.auth.admin.getUserById(user.auth_id)
  const pinBcrypt: string | undefined = authMeta?.user?.app_metadata?.pin_bcrypt
  const pinSha256: string | undefined = authMeta?.user?.app_metadata?.pin_sha256

  if (!pinBcrypt) {
    console.error('pin_bcrypt not found for user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  let pinOk = false
  const pairs = tryParsePairsPayload(pin_hash)
  if (pairs) {
    if (!pinSha256) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
    const result = await verifyPinWithPairs(pinSha256, pairs)
    pinOk = result.ok
  } else {
    pinOk = pinSha256 ? pin_hash === pinSha256 : await bcryptVerify(pin_hash, pinBcrypt)
  }
  if (!pinOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    user.id,
      event_type: 'descarregar_pin_failed',
      metadata:   { attempts: attempts + 1 },
    })
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
  }

  // ── Verificar resposta de segurança ──────────────────────────────────────────

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('answer_hash')
    .eq('user_id', user.id)

  if (!questions?.length) {
    console.error('No security questions for user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  const answerOk = (await Promise.all(
    questions.map(q => bcryptVerify(security_answer_hash, q.answer_hash))
  )).some(Boolean)

  if (!answerOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    user.id,
      event_type: 'descarregar_security_failed',
      metadata:   {},
    })
    return err('INVALID_CREDENTIALS', 'Resposta de segurança incorreta', 401)
  }

  // ── Buscar taxa cashout (spec §5.1: valor_enviado = amount * (1 - rates.cashout)) ─

  const { data: rateRow } = await supabaseAdmin
    .from('rates')
    .select('rate')
    .eq('type', 'cashout')
    .maybeSingle()

  const cashoutRate = Number(rateRow?.rate ?? 0.02)                         // fallback 2%
  const fee         = parseFloat((amount_albers * cashoutRate).toFixed(2))
  const netBrl      = parseFloat((amount_albers - fee).toFixed(2))

  // ── Descriptografar API key da subconta ──────────────────────────────────────

  if (!wallet.asaasApiKeyEnc) return err('ACCOUNT_NOT_CONFIGURED', 'Subconta não configurada', 503)

  let subApiKey: string
  try {
    subApiKey = await aesDecrypt(wallet.asaasApiKeyEnc, Deno.env.get('ASAAS_API_KEY')!)
  } catch (e) {
    console.error('API key decryption failed:', e)
    await logError(supabaseAdmin, 'financial-descarregar', e, safePayload)
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // ── Verificar saldo suficiente via Asaas ─────────────────────────────────────

  let currentBalance: number
  try {
    currentBalance = await getSubcontaBalance(subApiKey)
  } catch (e) {
    console.error('Asaas balance check failed:', e)
    await logError(supabaseAdmin, 'financial-descarregar', e, safePayload)
    return err('ASAAS_ERROR', 'Não foi possível verificar o saldo. Tente novamente.', 503)
  }

  if (currentBalance < amount_albers) {
    return err('INSUFFICIENT_BALANCE', 'Saldo insuficiente', 422)
  }

  // ── Inserir transações pending (idempotência — spec 04_api §6) ─────────────────

  const { data: txData, error: txInsErr } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:    user.id,
      company_id: wallet.companyId,
      type:       'descarregar',
      amount:     amount_albers,
      amount_brl: amount_albers,
      fee_amount: fee,
      status:     'pending',
      metadata:   { pix_key: wallet.pixKey, pix_key_type: wallet.pixKeyType, net_brl: netBrl },
    })
    .select('id')
    .single()

  if (txInsErr || !txData) {
    console.error('Transaction insert failed:', txInsErr)
    await logError(supabaseAdmin, 'financial-descarregar', txInsErr ?? new Error('tx_insert_failed'), safePayload)
    return err('DB_ERROR', 'Erro ao registrar transação', 500)
  }
  const transactionId = txData.id

  const { data: feeTxData } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:        user.id,
      company_id:     wallet.companyId,
      type:           'fee',
      amount:         fee,
      amount_brl:     fee,
      fee_amount:     0,
      status:         'pending',
      reference_id:   transactionId,
      reference_type: 'descarregar',
      metadata:       { source: 'descarregar_cashout' },
    })
    .select('id')
    .single()

  const feeTxId = feeTxData?.id

  // ── Descriptografar chave Pix para envio ─────────────────────────────────────

  let pixKeyRaw: string
  try {
    pixKeyRaw = await aesDecrypt(wallet.pixKey, Deno.env.get('ENCRYPTION_KEY')!)
  } catch (e) {
    console.error('pix_key decryption failed:', e)
    await logError(supabaseAdmin, 'financial-descarregar', e, safePayload)
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // ── Asaas: cash out via Pix externo (spec 04_api §4.5) ────────────────────────
  // DB stores 'random' for EVP keys; Asaas API requires 'EVP'.
  const asaasPixType = wallet.pixKeyType === 'random' ? 'EVP' : wallet.pixKeyType!.toUpperCase()

  let transfer: { id: string; status: string }
  try {
    transfer = await cashoutPix(netBrl, pixKeyRaw, asaasPixType, transactionId, subApiKey)
  } catch (e) {
    console.error('Asaas cashout failed:', e)
    const asaasResponse = e instanceof AsaasError ? e.asaasResponse : null
    await logError(supabaseAdmin, 'financial-descarregar', e, { ...safePayload, transaction_id: transactionId }, { asaas_response: asaasResponse })
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'failed' })
      .eq('id', transactionId)
    if (feeTxId) {
      await supabaseAdmin
        .from('transactions')
        .update({ status: 'failed' })
        .eq('id', feeTxId)
    }
    return err('ASAAS_ERROR', 'Falha ao processar a transferência Pix. Tente novamente.', 503)
  }

  // ── Asaas: transferir taxa para conta pai (spec §5.1) ────────────────────────
  // Não-crítico: se falhar, o saldo da taxa fica na subconta e é reconciliado manualmente.

  const parentWalletId = Deno.env.get('ASAAS_PARENT_WALLET_ID')
  if (parentWalletId && fee > 0) {
    try {
      await transferToWallet(fee, parentWalletId, 'Taxa descarregamento Alber', crypto.randomUUID(), subApiKey)
    } catch (e) {
      console.error('Fee transfer to parent failed (non-critical):', e)
      const asaasResponse = e instanceof AsaasError ? e.asaasResponse : null
      await logError(supabaseAdmin, 'financial-descarregar', e, { ...safePayload, fee, transaction_id: transactionId }, { asaas_response: asaasResponse })
    }
  }

  // ── Atualizar status das transações ──────────────────────────────────────────
  // descarregar → 'processing' (webhook TRANSFER_DONE atualizará para 'completed')
  // asaas_payment_id guarda o id do transfer Asaas para reconciliação no webhook.
  // fee → 'completed' imediatamente (foi debitado da subconta com sucesso)

  await supabaseAdmin
    .from('transactions')
    .update({ status: 'processing', asaas_payment_id: transfer.id })
    .eq('id', transactionId)

  if (feeTxId) {
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'completed' })
      .eq('id', feeTxId)
  }

  // ── Audit log ────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    user.id,
    event_type: 'descarregar_initiated',
    metadata: {
      transaction_id: transactionId,
      amount_albers,
      fee,
      net_brl: netBrl,
      pix_key:  wallet.pixKey,
      company_id: wallet.companyId,
    },
  })

  // ── Push notification (best-effort) ──────────────────────────────────────────

  await sendPush(
    user.id,
    'Pix enviado para processamento',
    `${amount_albers} Albers serão enviados para sua chave Pix`,
    { route: '/(app)/atividade' },
    'transaction',
  )

  return json({
    transaction_id: transactionId,
    amount_sent:    netBrl,
    fee,
    pix_key:        wallet.pixKey,
    status:         'processing',
  })
})
