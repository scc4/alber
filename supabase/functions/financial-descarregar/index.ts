// Spec: /specs/03_backend.md §4.4
// Spec: /specs/04_api_asaas.md §4.5 (cash out Pix externo)
// Fluxo: auth → validar PIN+segurança → verificar KYC/Pix/saldo →
//        Asaas cash out → taxa para conta pai → registrar TXs → audit

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { sha256hex, bcryptVerify, aesDecrypt, verifyPinWithPairs, tryParsePairsPayload } from '../_shared/crypto.ts'
import { normalizeCpf } from '../_shared/cpf.ts'
import { cashoutPix, transferToWallet, getSubcontaBalance } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

interface DescarregarRequest {
  amount_albers: number
  pin_hash: string
  security_answer_hash: string
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

  const { amount_albers, pin_hash, security_answer_hash } = body
  const safePayload = { amount_albers } as Record<string, unknown>

  if (!amount_albers || !pin_hash || !security_answer_hash) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }
  if (typeof amount_albers !== 'number' || amount_albers < MIN_AMOUNT) {
    return err('INVALID_AMOUNT', `Valor mínimo: ${MIN_AMOUNT} Albers`, 400)
  }

  // ── Buscar dados do usuário ──────────────────────────────────────────────────

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, auth_id, asaas_api_key_enc, kyc_status, pix_key, pix_key_type, cpf')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (userErr || !user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Verificar KYC obrigatório (spec §5.4) ────────────────────────────────────

  if (user.kyc_status !== 'approved') {
    return err('KYC_REQUIRED', 'Verificação de identidade necessária para descarregar', 403)
  }

  // ── Verificar chave Pix cadastrada ───────────────────────────────────────────

  if (!user.pix_key || !user.pix_key_type) {
    return err('PIX_KEY_MISSING', 'Chave Pix não cadastrada — configure em Perfil', 422)
  }

  // ── Verificar CPF da chave Pix = CPF do usuário (spec §5.4 — validação local) ─
  // Se a chave for do tipo CPF, o CPF da chave deve ser o mesmo titular da conta.

  if (user.pix_key_type === 'CPF') {
    const pixCpfHash = await sha256hex(normalizeCpf(user.pix_key))
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
    pinOk = await bcryptVerify(pin_hash, pinBcrypt)
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

  if (!user.asaas_api_key_enc) return err('ACCOUNT_NOT_CONFIGURED', 'Subconta não configurada', 503)

  let subApiKey: string
  try {
    subApiKey = await aesDecrypt(user.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
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
      type:       'descarregar',
      amount:     amount_albers,
      amount_brl: amount_albers,
      fee_amount: fee,
      status:     'pending',
      metadata:   { pix_key: user.pix_key, pix_key_type: user.pix_key_type, net_brl: netBrl },
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

  // ── Asaas: cash out via Pix externo (spec 04_api §4.5) ────────────────────────

  try {
    await cashoutPix(netBrl, user.pix_key, user.pix_key_type, transactionId, subApiKey)
  } catch (e) {
    console.error('Asaas cashout failed:', e)
    await logError(supabaseAdmin, 'financial-descarregar', e, { ...safePayload, transaction_id: transactionId })
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
      await logError(supabaseAdmin, 'financial-descarregar', e, { ...safePayload, fee, transaction_id: transactionId })
    }
  }

  // ── Atualizar status das transações ──────────────────────────────────────────
  // descarregar → 'processing' (webhook TRANSFER_CONFIRMED atualizará para 'completed')
  // fee → 'completed' imediatamente (foi debitado da subconta com sucesso)

  await supabaseAdmin
    .from('transactions')
    .update({ status: 'processing' })
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
      pix_key:  user.pix_key,
    },
  })

  return json({
    transaction_id: transactionId,
    amount_sent:    netBrl,
    fee,
    pix_key:        user.pix_key,
    status:         'processing',
  })
})
