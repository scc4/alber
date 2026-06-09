// Spec: /specs/03_backend.md §4.5
// Spec: /specs/04_api_asaas.md §4.4 (transferência inter-subconta)
// Fluxo: recebedor autenticado → localiza pagador → valida PIN+segurança do pagador
//        → calcula taxa → Asaas pagador→recebedor + pagador→pai → 3 TXs → push → audit

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { sha256hex, bcryptVerify, aesDecrypt, verifyPinWithPairs, tryParsePairsPayload } from '../_shared/crypto.ts'
import { normalizeCpf } from '../_shared/cpf.ts'
import { transferToWallet, getSubcontaBalance } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface ReceberRequest {
  amount_albers:               number
  payer_identifier:            string  // CPF, @handle ou telefone
  payer_pin_hash:              string  // SHA-256(PIN do pagador) — digitado pelo pagador
  payer_security_answer_hash:  string  // SHA-256(resposta) — digitado pelo pagador
}

interface UserRow {
  id:                string
  auth_id:           string
  name:              string
  handle:            string
  asaas_api_key_enc: string | null
  asaas_wallet_id:   string | null
}

const MAX_ATTEMPTS   = 3
const WINDOW_MINUTES = 15

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── Localizar pagador por @handle, CPF ou telefone ───────────────────────────

async function findPayer(identifier: string): Promise<UserRow | null> {
  const clean = identifier.trim()

  if (clean.startsWith('@')) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, auth_id, name, handle, asaas_api_key_enc, asaas_wallet_id')
      .ilike('handle', clean.toLowerCase())
      .maybeSingle()
    return data
  }

  const digits = clean.replace(/\D/g, '')

  if (digits.length === 11) {
    // CPF — comparado como SHA-256 (spec §6)
    const cpfHash = await sha256hex(normalizeCpf(digits))
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, auth_id, name, handle, asaas_api_key_enc, asaas_wallet_id')
      .eq('cpf', cpfHash)
      .maybeSingle()
    return data
  }

  if (digits.length >= 10) {
    // Telefone — armazenado como dígitos na coluna phone
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, auth_id, name, handle, asaas_api_key_enc, asaas_wallet_id')
      .eq('phone', digits)
      .maybeSingle()
    return data
  }

  return null
}

// ── Rate limiting do pagador ─────────────────────────────────────────────────

async function payerFailedAttempts(payerId: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', payerId)
    .in('event_type', ['receber_payer_pin_failed', 'receber_payer_security_failed'])
    .gte('created_at', since)
  return count ?? 0
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Autenticar JWT do recebedor ──────────────────────────────────────────────

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

  let body: ReceberRequest
  try { body = await req.json() } catch (e) {
    await logError(supabaseAdmin, 'financial-receber', e, {})
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { amount_albers, payer_identifier, payer_pin_hash, payer_security_answer_hash } = body
  const safePayload = { amount_albers, payer_identifier } as Record<string, unknown>

  if (!amount_albers || !payer_identifier || !payer_pin_hash || !payer_security_answer_hash) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }
  if (typeof amount_albers !== 'number' || amount_albers < 1) {
    return err('INVALID_AMOUNT', 'Valor deve ser >= 1 Alber', 400)
  }

  // ── Buscar dados do recebedor ────────────────────────────────────────────────

  const { data: receiver, error: rcvErr } = await supabaseAdmin
    .from('users')
    .select('id, name, handle, asaas_wallet_id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (rcvErr || !receiver) return err('USER_NOT_FOUND', 'Recebedor não encontrado', 404)

  if (!receiver.asaas_wallet_id) {
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta do recebedor não configurada', 503)
  }

  // ── Localizar pagador por identificador ──────────────────────────────────────

  const payer = await findPayer(payer_identifier)

  if (!payer) {
    return err('PAYER_NOT_FOUND', 'Pagador não encontrado', 404)
  }

  // ── Verificar recebedor ≠ pagador ────────────────────────────────────────────

  if (payer.id === receiver.id) {
    return err('SELF_TRANSFER', 'Não é possível receber de si mesmo', 422)
  }

  // ── Rate limiting do pagador ─────────────────────────────────────────────────

  const attempts = await payerFailedAttempts(payer.id)
  if (attempts >= MAX_ATTEMPTS) {
    return err(
      'TOO_MANY_ATTEMPTS',
      `Pagador bloqueado por ${WINDOW_MINUTES} minutos após tentativas excessivas`,
      429,
    )
  }

  // ── Verificar PIN do pagador ─────────────────────────────────────────────────

  const { data: payerAuth } = await supabaseAdmin.auth.admin.getUserById(payer.auth_id)
  const pinBcrypt: string | undefined = payerAuth?.user?.app_metadata?.pin_bcrypt
  const pinSha256: string | undefined = payerAuth?.user?.app_metadata?.pin_sha256

  if (!pinBcrypt) {
    console.error('pin_bcrypt not found for payer:', payer.id)
    return err('INVALID_CREDENTIALS', 'Credenciais do pagador inválidas', 401)
  }

  let pinOk = false
  const pairs = tryParsePairsPayload(payer_pin_hash)
  if (pairs) {
    if (!pinSha256) return err('INVALID_CREDENTIALS', 'Credenciais do pagador inválidas', 401)
    const result = await verifyPinWithPairs(pinSha256, pairs)
    pinOk = result.ok
  } else {
    pinOk = await bcryptVerify(payer_pin_hash, pinBcrypt)
  }
  if (!pinOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    payer.id,
      event_type: 'receber_payer_pin_failed',
      metadata:   { receiver_id: receiver.id, attempts: attempts + 1 },
    })
    return err('INVALID_CREDENTIALS', 'PIN do pagador incorreto', 401)
  }

  // ── Verificar resposta de segurança do pagador ───────────────────────────────

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('answer_hash')
    .eq('user_id', payer.id)

  if (!questions?.length) {
    console.error('No security questions for payer:', payer.id)
    return err('INVALID_CREDENTIALS', 'Credenciais do pagador inválidas', 401)
  }

  const answerOk = (await Promise.all(
    questions.map(q => bcryptVerify(payer_security_answer_hash, q.answer_hash))
  )).some(Boolean)

  if (!answerOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    payer.id,
      event_type: 'receber_payer_security_failed',
      metadata:   { receiver_id: receiver.id },
    })
    return err('INVALID_CREDENTIALS', 'Resposta de segurança do pagador incorreta', 401)
  }

  // ── Buscar taxa receber (spec §5.1) ──────────────────────────────────────────
  // Pagador paga: amount + fee. Recebedor recebe: amount. Pai recebe: fee.

  const { data: rateRow } = await supabaseAdmin
    .from('rates')
    .select('rate')
    .eq('type', 'receber')
    .maybeSingle()

  const receberRate  = Number(rateRow?.rate ?? 0.02)                          // fallback 2%
  const fee          = parseFloat((amount_albers * receberRate).toFixed(2))
  const payerDebit   = parseFloat((amount_albers + fee).toFixed(2))

  // ── Verificar saldo do pagador >= amount + taxa ──────────────────────────────

  if (!payer.asaas_api_key_enc) {
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta do pagador não configurada', 503)
  }

  let payerApiKey: string
  try {
    payerApiKey = await aesDecrypt(payer.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
  } catch (e) {
    console.error('Payer API key decryption failed:', e)
    await logError(supabaseAdmin, 'financial-receber', e, safePayload)
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  let payerBalance: number
  try {
    payerBalance = await getSubcontaBalance(payerApiKey)
  } catch (e) {
    console.error('Payer balance check failed:', e)
    await logError(supabaseAdmin, 'financial-receber', e, safePayload)
    return err('ASAAS_ERROR', 'Não foi possível verificar saldo do pagador', 503)
  }

  if (payerBalance < payerDebit) {
    return err('INSUFFICIENT_BALANCE', 'Saldo insuficiente do pagador', 422)
  }

  // ── Inserir 3 transações pending (idempotência — spec 04_api §6) ─────────────

  // TX 1: enviar (débito do pagador)
  const { data: payerTxData, error: ptxErr } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:    payer.id,
      type:       'enviar',
      amount:     amount_albers,
      amount_brl: amount_albers,
      fee_amount: fee,
      status:     'pending',
      metadata:   { receiver_id: receiver.id, receiver_handle: receiver.handle },
    })
    .select('id')
    .single()

  if (ptxErr || !payerTxData) {
    console.error('Payer transaction insert failed:', ptxErr)
    await logError(supabaseAdmin, 'financial-receber', ptxErr ?? new Error('payer_tx_insert_failed'), safePayload)
    return err('DB_ERROR', 'Erro ao registrar transação', 500)
  }
  const payerTxId = payerTxData.id

  // TX 2: receber (crédito do recebedor)
  const { data: rcvTxData } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:        receiver.id,
      type:           'receber',
      amount:         amount_albers,
      amount_brl:     amount_albers,
      fee_amount:     0,
      status:         'pending',
      reference_id:   payerTxId,
      reference_type: 'enviar',
      metadata:       { payer_id: payer.id, payer_handle: payer.handle },
    })
    .select('id')
    .single()

  const rcvTxId = rcvTxData?.id

  // TX 3: fee (crédito da conta pai)
  const { data: feeTxData } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:        payer.id,
      type:           'fee',
      amount:         fee,
      amount_brl:     fee,
      fee_amount:     0,
      status:         'pending',
      reference_id:   payerTxId,
      reference_type: 'enviar',
      metadata:       { source: 'receber_fee' },
    })
    .select('id')
    .single()

  const feeTxId = feeTxData?.id

  // ── Asaas: pagador → recebedor (spec 04_api §4.4) ────────────────────────────

  try {
    await transferToWallet(
      amount_albers,
      receiver.asaas_wallet_id,
      `Recebimento Alber — ${receiver.handle}`,
      payerTxId,
      payerApiKey,
    )
  } catch (e) {
    console.error('Asaas transfer payer→receiver failed:', e)
    await logError(supabaseAdmin, 'financial-receber', e, { ...safePayload, payer_tx_id: payerTxId })
    const failIds = [payerTxId, rcvTxId, feeTxId].filter(Boolean) as string[]
    await supabaseAdmin.from('transactions').update({ status: 'failed' }).in('id', failIds)
    return err('ASAAS_ERROR', 'Falha ao processar a transferência. Tente novamente.', 503)
  }

  // ── Asaas: pagador → conta pai (taxa) (spec §5.1) ────────────────────────────

  const parentWalletId = Deno.env.get('ASAAS_PARENT_WALLET_ID')
  if (parentWalletId && fee > 0) {
    try {
      await transferToWallet(
        fee,
        parentWalletId,
        'Taxa recebimento Alber',
        crypto.randomUUID(),
        payerApiKey,
      )
    } catch (e) {
      // Não-crítico: taxa fica na subconta do pagador — reconciliar manualmente
      console.error('Fee transfer to parent failed (non-critical):', e)
      await logError(supabaseAdmin, 'financial-receber', e, { ...safePayload, fee, payer_tx_id: payerTxId })
    }
  }

  // ── Atualizar todas as TXs para 'completed' ───────────────────────────────────

  const completedIds = [payerTxId, rcvTxId, feeTxId].filter(Boolean) as string[]
  await supabaseAdmin
    .from('transactions')
    .update({ status: 'completed' })
    .in('id', completedIds)

  // ── Push notifications (best-effort) ────────────────────────────────────────

  await Promise.allSettled([
    sendPush(
      payer.id,
      'Pagamento enviado',
      `Você pagou ${amount_albers} Albers para ${receiver.handle}`,
      { route: '/(app)/atividade' },
    ),
    sendPush(
      receiver.id,
      'Pagamento recebido',
      `${payer.name} pagou ${amount_albers} Albers para você`,
      { route: '/(app)/atividade' },
    ),
  ])

  // ── Audit log ────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    payer.id,
    event_type: 'receber_completed',
    metadata: {
      payer_tx_id:  payerTxId,
      receiver_id:  receiver.id,
      amount_albers,
      fee,
      payer_debit:  payerDebit,
    },
  })

  return json({
    transaction_id:  payerTxId,
    amount_received: amount_albers,
    fee,
    payer_name:      payer.name,
    status:          'completed',
  })
})
