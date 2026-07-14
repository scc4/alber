// Spec: /specs/06_modules/split.md §3, §5, §6
// Cria split fixo ou variável. Participantes são escolhidos na criação — não há
// convite por link/entrada depois — mas entram como 'pending': ninguém é cobrado
// aqui. Cada participante aprova (ou recusa) individualmente em split-invite-respond,
// e é só na aprovação que a transferência Asaas real acontece.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt } from '../_shared/crypto.ts'
import { getSubcontaBalance } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface CreateRequest {
  name:                string
  type:                'fixed' | 'variable'
  target_amount:       number
  max_participants:    number   // inclui o dono; mínimo 2
  participant_handles: string[] // obrigatório — deve preencher exatamente max_participants - 1
}

interface ResolvedParticipant {
  id:     string
  handle: string
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

  let body: CreateRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { name, type, target_amount, max_participants, participant_handles } = body

  if (!name?.trim())
    return err('MISSING_FIELDS', 'Nome do split é obrigatório', 400)
  if (!['fixed', 'variable'].includes(type))
    return err('INVALID_TYPE', 'Tipo deve ser fixed ou variable', 400)
  if (typeof target_amount !== 'number' || target_amount <= 0)
    return err('INVALID_AMOUNT', 'Valor deve ser maior que zero', 400)
  if (typeof max_participants !== 'number' || max_participants < 2)
    return err('INVALID_PARTICIPANTS', 'Mínimo 2 participantes incluindo o dono', 400)
  if (!Array.isArray(participant_handles) || participant_handles.length !== max_participants - 1)
    return err('INVALID_PARTICIPANTS', 'Selecione todos os participantes antes de criar o split', 400)

  // ── Buscar dono ───────────────────────────────────────────────────────────────

  const { data: owner, error: ownerErr } = await supabaseAdmin
    .from('users')
    .select('id, handle, asaas_api_key_enc, asaas_wallet_id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (ownerErr || !owner) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  if (!owner.asaas_wallet_id)
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta financeira não configurada', 503)

  // ── Resolver participantes ANTES de criar qualquer coisa ─────────────────────
  // Aqui só validamos que os handles existem e têm conta financeira configurada
  // (estado estático). Saldo é checado só na aprovação — não faz sentido validar
  // agora um valor que pode mudar até lá, e ninguém é cobrado nesta etapa.

  const ownerHandleNoAt = (owner.handle ?? '').replace(/^@/, '').toLowerCase()
  const normalizedHandles = participant_handles.map(h => (h ?? '').replace(/^@/, '').toLowerCase().trim())

  if (normalizedHandles.some(h => h === ownerHandleNoAt))
    return err('CANNOT_INVITE_SELF', 'Você já é o dono do split', 422)

  if (new Set(normalizedHandles).size !== normalizedHandles.length)
    return err('DUPLICATE_PARTICIPANT', 'Participantes duplicados na lista', 422)

  const amountPerPerson = parseFloat((target_amount / max_participants).toFixed(2))

  const resolvedParticipants: ResolvedParticipant[] = []
  const notFoundHandles:      string[] = []
  const noAccountHandles:     string[] = []

  try {
    for (const handleNoAt of normalizedHandles) {
      const { data: invitee, error: lookupErr } = await supabaseAdmin
        .from('users')
        .select('id, handle, asaas_api_key_enc')
        .or(`handle.ilike.${handleNoAt},handle.ilike.@${handleNoAt}`)
        .maybeSingle()

      if (lookupErr || !invitee) {
        notFoundHandles.push(handleNoAt)
        continue
      }
      if (!invitee.asaas_api_key_enc) {
        noAccountHandles.push(invitee.handle)
        continue
      }

      resolvedParticipants.push({ id: invitee.id, handle: invitee.handle })
    }
  } catch (e) {
    await logError(supabaseAdmin, 'split-create', e, { owner_id: owner.id, step: 'resolve_participants' })
    return err('DB_ERROR', 'Erro ao verificar participantes', 500)
  }

  if (notFoundHandles.length > 0) {
    return err(
      'PARTICIPANTS_NOT_FOUND',
      `Usuário(s) não encontrado(s): ${notFoundHandles.join(', ')}`,
      422,
      { not_found_handles: notFoundHandles },
    )
  }
  if (noAccountHandles.length > 0) {
    return err(
      'PARTICIPANTS_NO_ACCOUNT',
      `Conta financeira não configurada: ${noAccountHandles.join(', ')}`,
      422,
      { no_account_handles: noAccountHandles },
    )
  }
  if (new Set(resolvedParticipants.map(p => p.id)).size !== resolvedParticipants.length)
    return err('DUPLICATE_PARTICIPANT', 'Participantes duplicados na lista', 422)

  // ── Variable: verificar saldo do dono para bloquear a própria quota ──────────
  // (virtual — sem Asaas transfer, o dinheiro já está na subconta do dono)

  if (type === 'variable') {
    if (!owner.asaas_api_key_enc)
      return err('ACCOUNT_NOT_CONFIGURED', 'Conta financeira não configurada', 503)

    let ownerApiKey: string
    try {
      ownerApiKey = await aesDecrypt(owner.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
    } catch (e) {
      await logError(supabaseAdmin, 'split-create', e, { owner_id: owner.id })
      return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
    }

    let ownerBalance: number
    try {
      ownerBalance = await getSubcontaBalance(ownerApiKey)
    } catch (e) {
      await logError(supabaseAdmin, 'split-create', e, { owner_id: owner.id })
      return err('ASAAS_ERROR', 'Não foi possível verificar saldo', 503)
    }

    if (ownerBalance < amountPerPerson) {
      return err(
        'INSUFFICIENT_BALANCE',
        `Saldo insuficiente. Necessário: ${amountPerPerson.toFixed(2)} Albers`,
        422,
      )
    }
  }

  // ── Criar split ───────────────────────────────────────────────────────────────
  // Nasce sempre 'open' — mesmo fixed, já que ninguém foi cobrado ainda.
  // Fecha (fixed) quando o último participante pendente aprovar — ver
  // split-invite-respond.

  const nowIso = new Date().toISOString()

  const { data: split, error: splitErr } = await supabaseAdmin
    .from('splits')
    .insert({
      owner_id:      owner.id,
      name:          name.trim(),
      type,
      target_amount,
      max_participants,
      status:        'open',
    })
    .select('id')
    .single()

  if (splitErr || !split) {
    await logError(supabaseAdmin, 'split-create', splitErr ?? new Error('split_insert_failed'), { owner_id: owner.id })
    return err('DB_ERROR', 'Erro ao criar split', 500)
  }

  const splitId = split.id

  // ── Registrar dono + participantes selecionados, com rollback em falha ───────
  // Dono: 'accepted' de cara (fixed: blocked_amount 0, é recebedor; variable:
  // quota bloqueada virtualmente). Convidados: 'pending' — sem cobrança, sem
  // blocked_amount, até aprovarem individualmente.

  const participantRows = [
    {
      split_id:       splitId,
      user_id:        owner.id,
      status:         'accepted',
      blocked_amount: type === 'variable' ? amountPerPerson : 0,
      joined_at:      nowIso,
    },
    ...resolvedParticipants.map(p => ({
      split_id:       splitId,
      user_id:        p.id,
      status:         'pending',
      blocked_amount: 0,
      joined_at:      null,
    })),
  ]

  const { error: partErr } = await supabaseAdmin.from('split_participants').insert(participantRows)

  if (partErr) {
    await logError(supabaseAdmin, 'split-create', partErr, { split_id: splitId })
    await supabaseAdmin.from('splits').delete().eq('id', splitId)
    return err('DB_ERROR', 'Erro ao registrar participantes', 500)
  }

  // ── Registrar split_block do dono (variável, sem transfer Asaas) ─────────────

  if (type === 'variable' && amountPerPerson > 0) {
    try {
      await supabaseAdmin.from('transactions').insert({
        user_id:        owner.id,
        type:           'split_block',
        amount:         amountPerPerson,
        amount_brl:     amountPerPerson,
        fee_amount:     0,
        status:         'completed',
        reference_id:   splitId,
        reference_type: 'split',
        metadata:       { split_id: splitId, split_name: name.trim() },
      })
    } catch (e) {
      console.error('[split-create] split_block tx failed (non-critical):', e)
    }
  }

  // ── Audit log ─────────────────────────────────────────────────────────────────

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    owner.id,
      event_type: 'split_created',
      metadata:   { split_id: splitId, type, target_amount, max_participants },
    })
  } catch { /* best-effort */ }

  // ── Notificar participantes convidados (best-effort) ─────────────────────────

  for (const p of resolvedParticipants) {
    sendPush(
      p.id,
      'Você foi convidado para um Split',
      `${owner.handle} te convidou pro split "${name.trim()}" — aprove para entrar`,
      { route: `/(app)/split/${splitId}` },
      'invite',
    ).catch(() => {})
  }

  return json({ split_id: splitId }, 201)
})
