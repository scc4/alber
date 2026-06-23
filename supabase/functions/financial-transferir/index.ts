// Spec: /specs/03_backend.md §4.6
// Spec: /specs/04_api_asaas.md §4.4 (transferência inter-subconta)
// Fluxo: remetente autenticado → localiza destinatário → valida PIN+segurança
//        → verifica saldo → Asaas remetente→destinatário → 2 TXs → push → audit
// Nota: transferir interno não tem taxa (spec §4.6: "sem taxa")

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { sha256hex, bcryptVerify, aesDecrypt, verifyPinWithPairs, tryParsePairsPayload } from '../_shared/crypto.ts'
import { normalizeCpf } from '../_shared/cpf.ts'
import { transferToWallet, getSubcontaBalance, AsaasError } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface TransferirRequest {
  destinatario_identifier: string   // CPF, @handle ou e-mail
  amount_albers:           number
  pin_hash:                string   // SHA-256(PIN do remetente)
  security_answer_hash:    string   // SHA-256(resposta do remetente)
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

// ── Localizar destinatário por @handle, CPF ou e-mail ────────────────────────

async function findRecipient(identifier: string): Promise<UserRow | null> {
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

  // E-mail (fallback)
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, auth_id, name, handle, asaas_api_key_enc, asaas_wallet_id')
    .ilike('email', clean.toLowerCase())
    .maybeSingle()
  return data
}

// ── Rate limiting do remetente ───────────────────────────────────────────────

async function failedAttempts(userId: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('event_type', ['transferir_pin_failed', 'transferir_security_failed'])
    .gte('created_at', since)
  return count ?? 0
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Autenticar JWT do remetente ──────────────────────────────────────────────

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

  let body: TransferirRequest
  try { body = await req.json() } catch (e) {
    await logError(supabaseAdmin, 'financial-transferir', e, {})
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { destinatario_identifier, amount_albers, pin_hash, security_answer_hash } = body
  const safePayload = { destinatario_identifier, amount_albers } as Record<string, unknown>

  if (!destinatario_identifier || !amount_albers || !pin_hash || !security_answer_hash) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }
  if (typeof amount_albers !== 'number' || amount_albers < 1) {
    return err('INVALID_AMOUNT', 'Valor deve ser >= 1 Alber', 400)
  }

  // ── Buscar dados do remetente ────────────────────────────────────────────────

  const { data: sender, error: sndErr } = await supabaseAdmin
    .from('users')
    .select('id, auth_id, name, handle, asaas_api_key_enc, asaas_wallet_id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (sndErr || !sender) return err('USER_NOT_FOUND', 'Remetente não encontrado', 404)

  // ── Localizar destinatário ───────────────────────────────────────────────────

  const recipient = await findRecipient(destinatario_identifier)

  if (!recipient) {
    return err('RECIPIENT_NOT_FOUND', 'Destinatário não encontrado', 404)
  }

  // ── Verificar remetente ≠ destinatário ───────────────────────────────────────

  if (sender.id === recipient.id) {
    return err('SELF_TRANSFER', 'Não é possível transferir para si mesmo', 422)
  }

  // ── Rate limiting do remetente ───────────────────────────────────────────────

  const attempts = await failedAttempts(sender.id)
  if (attempts >= MAX_ATTEMPTS) {
    return err(
      'TOO_MANY_ATTEMPTS',
      `Operação bloqueada por ${WINDOW_MINUTES} minutos após tentativas excessivas`,
      429,
    )
  }

  // ── Verificar PIN do remetente ───────────────────────────────────────────────

  const { data: authMeta } = await supabaseAdmin.auth.admin.getUserById(sender.auth_id)
  const pinBcrypt: string | undefined = authMeta?.user?.app_metadata?.pin_bcrypt
  const pinSha256: string | undefined = authMeta?.user?.app_metadata?.pin_sha256

  if (!pinBcrypt) {
    console.error('pin_bcrypt not found for sender:', sender.id)
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
      user_id:    sender.id,
      event_type: 'transferir_pin_failed',
      metadata:   { destinatario_id: recipient.id, attempts: attempts + 1 },
    })
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
  }

  // ── Verificar resposta de segurança ──────────────────────────────────────────

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('answer_hash')
    .eq('user_id', sender.id)

  if (!questions?.length) {
    console.error('No security questions for sender:', sender.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  const answerOk = (await Promise.all(
    questions.map(q => bcryptVerify(security_answer_hash, q.answer_hash))
  )).some(Boolean)

  if (!answerOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    sender.id,
      event_type: 'transferir_security_failed',
      metadata:   { destinatario_id: recipient.id },
    })
    return err('INVALID_CREDENTIALS', 'Resposta de segurança incorreta', 401)
  }

  // ── Descriptografar API key do remetente ─────────────────────────────────────

  if (!sender.asaas_api_key_enc) {
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta do remetente não configurada', 503)
  }

  let senderApiKey: string
  try {
    senderApiKey = await aesDecrypt(sender.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
  } catch (e) {
    console.error('Sender API key decryption failed:', e)
    await logError(supabaseAdmin, 'financial-transferir', e, safePayload)
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // ── Verificar saldo suficiente (sem taxa — spec §4.6) ────────────────────────

  let senderBalance: number
  try {
    senderBalance = await getSubcontaBalance(senderApiKey)
  } catch (e) {
    console.error('Sender balance check failed:', e)
    await logError(supabaseAdmin, 'financial-transferir', e, safePayload)
    return err('ASAAS_ERROR', 'Não foi possível verificar o saldo. Tente novamente.', 503)
  }

  if (senderBalance < amount_albers) {
    return err('INSUFFICIENT_BALANCE', 'Saldo insuficiente', 422)
  }

  if (!recipient.asaas_wallet_id) {
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta do destinatário não configurada', 503)
  }

  // ── Inserir 2 transações pending (idempotência — spec 04_api §6) ─────────────

  // TX 1: transferir_enviado (débito do remetente)
  const { data: sndTxData, error: stxErr } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:    sender.id,
      type:       'transferir_enviado',
      amount:     amount_albers,
      amount_brl: amount_albers,
      fee_amount: 0,
      status:     'pending',
      metadata:   { destinatario_id: recipient.id, destinatario_handle: recipient.handle },
    })
    .select('id')
    .single()

  if (stxErr || !sndTxData) {
    console.error('Sender transaction insert failed:', stxErr)
    await logError(supabaseAdmin, 'financial-transferir', stxErr ?? new Error('sender_tx_insert_failed'), safePayload)
    return err('DB_ERROR', 'Erro ao registrar transação', 500)
  }
  const senderTxId = sndTxData.id

  // TX 2: transferir_recebido (crédito do destinatário)
  const { data: rcpTxData } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:        recipient.id,
      type:           'transferir_recebido',
      amount:         amount_albers,
      amount_brl:     amount_albers,
      fee_amount:     0,
      status:         'pending',
      reference_id:   senderTxId,
      reference_type: 'transferir_enviado',
      metadata:       { remetente_id: sender.id, remetente_handle: sender.handle },
    })
    .select('id')
    .single()

  const recipientTxId = rcpTxData?.id

  // ── Asaas: remetente → destinatário (spec 04_api §4.4) ───────────────────────

  try {
    await transferToWallet(
      amount_albers,
      recipient.asaas_wallet_id,
      `Transferência Alber — ${sender.handle} → ${recipient.handle}`,
      senderTxId,
      senderApiKey,
    )
  } catch (e) {
    console.error('Asaas transfer sender→recipient failed:', e)
    const asaasResponse = e instanceof AsaasError ? e.asaasResponse : null
    await logError(supabaseAdmin, 'financial-transferir', e, { ...safePayload, sender_tx_id: senderTxId }, { asaas_response: asaasResponse })
    const failIds = [senderTxId, recipientTxId].filter(Boolean) as string[]
    await supabaseAdmin.from('transactions').update({ status: 'failed' }).in('id', failIds)
    return err('ASAAS_ERROR', 'Falha ao processar a transferência. Tente novamente.', 503)
  }

  // ── Atualizar ambas as TXs para 'completed' ───────────────────────────────────

  const completedIds = [senderTxId, recipientTxId].filter(Boolean) as string[]
  await supabaseAdmin
    .from('transactions')
    .update({ status: 'completed' })
    .in('id', completedIds)

  // ── Novo saldo do remetente (best-effort — pode ser ligeiramente desatualizado) ─

  let novoSaldo = senderBalance - amount_albers
  try {
    novoSaldo = await getSubcontaBalance(senderApiKey)
  } catch {
    // Mantém cálculo local se a chamada falhar
  }

  // ── Push notification para destinatário (best-effort) ────────────────────────

  await sendPush(
    recipient.id,
    'Transferência recebida',
    `${sender.name} transferiu ${amount_albers} Albers para você`,
    { route: '/(app)/atividade' },
  )

  // ── Audit log ────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    sender.id,
    event_type: 'transferir_completed',
    metadata: {
      sender_tx_id:    senderTxId,
      destinatario_id: recipient.id,
      amount_albers,
      novo_saldo:      novoSaldo,
    },
  })

  return json({
    transaction_id:       senderTxId,
    amount:               amount_albers,
    destinatario_handle:  recipient.handle,
    novo_saldo:           novoSaldo,
  })
})
