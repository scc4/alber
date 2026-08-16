// Spec: /specs/06_modules/split.md §3, §5
// Participante responde ao próprio convite pendente de um split (self-service —
// sem checagem de owner/admin, só que a linha em split_participants pertença ao
// caller). Aprovar dispara a transferência Asaas real (participante → dono) e
// promove a linha para 'accepted'. Recusar remove a linha.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt } from '../_shared/crypto.ts'
import { getSubcontaBalance, transferToWallet, AsaasError } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface RespondRequest {
  split_id: string
  approved: boolean
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ─────────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Parse body ────────────────────────────────────────────────────────────────

  let body: RespondRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.split_id || typeof body.approved !== 'boolean')
    return err('MISSING_FIELDS', 'split_id e approved são obrigatórios', 400)

  // ── Buscar caller ────────────────────────────────────────────────────────────

  const { data: caller, error: callerErr } = await supabaseAdmin
    .from('users')
    .select('id, handle, asaas_api_key_enc')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (callerErr || !caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Buscar a própria linha pendente ──────────────────────────────────────────

  const { data: target, error: targetErr } = await supabaseAdmin
    .from('split_participants')
    .select('id, status')
    .eq('split_id', body.split_id)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (targetErr || !target) return err('NOT_A_PARTICIPANT', 'Você não foi convidado para este split', 404)
  if (target.status !== 'pending') return err('NOT_PENDING', 'Este convite já foi respondido', 422)

  // ── Buscar o split ───────────────────────────────────────────────────────────

  const { data: split, error: splitErr } = await supabaseAdmin
    .from('splits')
    .select('id, name, type, status, owner_id, target_amount, max_participants')
    .eq('id', body.split_id)
    .maybeSingle()

  if (splitErr || !split) return err('SPLIT_NOT_FOUND', 'Split não encontrado', 404)
  if (split.status !== 'open') return err('SPLIT_CLOSED', 'Este split não está mais aberto', 422)

  // ── Recusar ──────────────────────────────────────────────────────────────────

  if (!body.approved) {
    const { error: deleteErr } = await supabaseAdmin
      .from('split_participants')
      .delete()
      .eq('id', target.id)

    if (deleteErr) {
      await logError(supabaseAdmin, 'split-invite-respond', deleteErr, { split_id: split.id, user_id: caller.id })
      return err('DB_ERROR', 'Erro ao recusar convite', 500)
    }

    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id:    caller.id,
        event_type: 'split_invite_declined',
        metadata:   { split_id: split.id },
      })
    } catch { /* best-effort */ }

    sendPush(
      split.owner_id,
      'Convite recusado',
      `${caller.handle} recusou o convite pro split "${split.name}"`,
      { route: `/(app)/split/${split.id}` },
      'invite',
      'split_participant',
    ).catch(() => {})

    return json({ split_id: split.id, status: 'declined' })
  }

  // ── Aprovar: cobrar via Asaas antes de promover a linha ──────────────────────

  const { data: ownerUser } = await supabaseAdmin
    .from('users')
    .select('asaas_wallet_id')
    .eq('id', split.owner_id)
    .maybeSingle()

  if (!ownerUser?.asaas_wallet_id)
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta do dono não configurada', 503)

  if (!caller.asaas_api_key_enc)
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta financeira não configurada', 503)

  let callerApiKey: string
  try {
    callerApiKey = await aesDecrypt(caller.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
  } catch (e) {
    await logError(supabaseAdmin, 'split-invite-respond', e, { split_id: split.id, user_id: caller.id })
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  let callerBalance: number
  try {
    callerBalance = await getSubcontaBalance(callerApiKey)
  } catch (e) {
    await logError(supabaseAdmin, 'split-invite-respond', e, { split_id: split.id, user_id: caller.id })
    return err('ASAAS_ERROR', 'Não foi possível verificar saldo', 503)
  }

  const amountPerPerson = parseFloat((Number(split.target_amount) / split.max_participants).toFixed(2))

  if (callerBalance < amountPerPerson) {
    return err(
      'INSUFFICIENT_BALANCE',
      `Saldo insuficiente. Necessário: ${amountPerPerson.toFixed(2)} Albers`,
      422,
    )
  }

  const debitType = split.type === 'fixed' ? 'split_debit' : 'split_block'

  const { data: txRow } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:        caller.id,
      type:           debitType,
      amount:         amountPerPerson,
      amount_brl:     amountPerPerson,
      fee_amount:     0,
      status:         'pending',
      reference_id:   split.id,
      reference_type: 'split',
      metadata:       { split_id: split.id, split_name: split.name, owner_id: split.owner_id },
    })
    .select('id')
    .single()

  const txId = txRow?.id ?? crypto.randomUUID()

  try {
    await transferToWallet(amountPerPerson, ownerUser.asaas_wallet_id, `Split: ${split.name}`, txId, callerApiKey)
    await supabaseAdmin.from('transactions').update({ status: 'completed' }).eq('id', txId)
  } catch (e) {
    const asaasResponse = e instanceof AsaasError ? e.asaasResponse : null
    await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', txId)
    await logError(supabaseAdmin, 'split-invite-respond', e,
      { split_id: split.id, user_id: caller.id },
      { asaas_response: asaasResponse },
    )
    return err(
      'ASAAS_ERROR',
      'Falha ao processar pagamento. Tente novamente.',
      503,
    )
  }

  const nowIso = new Date().toISOString()

  const { error: updateErr } = await supabaseAdmin
    .from('split_participants')
    .update({
      status:         'accepted',
      blocked_amount: split.type === 'variable' ? amountPerPerson : 0,
      joined_at:      nowIso,
    })
    .eq('id', target.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'split-invite-respond', updateErr, { split_id: split.id, user_id: caller.id })
    return err('DB_ERROR', 'Pagamento processado, mas erro ao registrar participante. Contate o suporte.', 500)
  }

  // ── Fixed: fecha o split quando não sobrar ninguém pendente ──────────────────

  if (split.type === 'fixed') {
    const { count: stillPending } = await supabaseAdmin
      .from('split_participants')
      .select('id', { count: 'exact', head: true })
      .eq('split_id', split.id)
      .eq('status', 'pending')

    if ((stillPending ?? 0) === 0) {
      await supabaseAdmin
        .from('splits')
        .update({ status: 'closed', closed_at: nowIso })
        .eq('id', split.id)
    }
  }

  // ── Audit log + push pro dono ─────────────────────────────────────────────────

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    caller.id,
      event_type: 'split_invite_accepted',
      metadata:   { split_id: split.id, amount: amountPerPerson },
    })
  } catch { /* best-effort */ }

  sendPush(
    split.owner_id,
    'Novo participante',
    `${caller.handle} entrou no split "${split.name}"`,
    { route: `/(app)/split/${split.id}` },
    'invite',
    'split_participant',
  ).catch(() => {})

  return json({ split_id: split.id, status: 'accepted' })
})
