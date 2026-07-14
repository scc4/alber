// Spec: /specs/06_modules/split.md §3, §6
// Cria split fixo ou variável. Participantes são escolhidos e fixados na
// criação — não há mais convite por link/entrada depois (spec atualizada).
// Cada participante selecionado paga sua quota via transfer Asaas real para
// a carteira do dono no momento da criação (mesma regra que antes vivia em
// split-join, agora executada para todos de uma vez, atomicamente):
//   Fixed:    débito imediato participante → dono (dono não paga, é recebedor).
//   Variable: débito imediato participante → dono; quota do dono é bloqueada
//             virtualmente (sem TX Asaas — dinheiro já está na subconta dele).
// Para evitar cobrar alguns participantes e falhar nos demais, o saldo de
// TODOS é validado antes de qualquer transferência ser disparada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt } from '../_shared/crypto.ts'
import { getSubcontaBalance, transferToWallet, AsaasError } from '../_shared/asaas.ts'
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
  id:            string
  handle:        string
  apiKey:        string
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

  // ── Resolver participantes ANTES de criar/cobrar qualquer coisa ──────────────
  // Nada é gravado no banco e nenhum Asaas transfer é disparado até que todos
  // os handles selecionados sejam resolvidos e tenham saldo suficiente.

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
  const insufficientHandles:  string[] = []

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

      const apiKey = await aesDecrypt(invitee.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
      const balance = await getSubcontaBalance(apiKey)
      if (balance < amountPerPerson) {
        insufficientHandles.push(invitee.handle)
        continue
      }

      resolvedParticipants.push({ id: invitee.id, handle: invitee.handle, apiKey })
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
  if (insufficientHandles.length > 0) {
    return err(
      'PARTICIPANTS_INSUFFICIENT_BALANCE',
      `Saldo insuficiente: ${insufficientHandles.join(', ')}`,
      422,
      { insufficient_handles: insufficientHandles },
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

  const nowIso = new Date().toISOString()

  // Fixed: todos os participantes já entram pagos — não há mais uma fase de
  // "aguardando adesão", então o split nasce fechado (antes isso acontecia
  // via auto-close em split-join quando o último participante entrava).
  // Variable: continua 'open' — segue o fluxo de lançamentos + fechamento manual.

  const { data: split, error: splitErr } = await supabaseAdmin
    .from('splits')
    .insert({
      owner_id:      owner.id,
      name:          name.trim(),
      type,
      target_amount,
      max_participants,
      status:        type === 'fixed' ? 'closed' : 'open',
      closed_at:     type === 'fixed' ? nowIso : null,
    })
    .select('id')
    .single()

  if (splitErr || !split) {
    await logError(supabaseAdmin, 'split-create', splitErr ?? new Error('split_insert_failed'), { owner_id: owner.id })
    return err('DB_ERROR', 'Erro ao criar split', 500)
  }

  const splitId = split.id

  // ── Registrar dono + participantes selecionados, com rollback em falha ───────
  // Fixed: dono é recebedor — blocked_amount = 0, não paga via split.
  // Variable: quota do dono bloqueada virtualmente.
  // Todos entram como 'accepted' — não há mais estado "aguardando aceite".

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
      status:         'accepted',
      blocked_amount: type === 'variable' ? amountPerPerson : 0,
      joined_at:      nowIso,
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

  // ── Cobrar cada participante: transfer Asaas real → carteira do dono ─────────
  // Saldo já foi pré-validado para todos; uma falha aqui é rara (erro
  // transiente do Asaas). Sem estorno automático: se acontecer, o split é
  // desfeito e o incidente fica registrado em detalhe para reconciliação
  // manual (algum participante pode já ter sido debitado).

  const debitType = type === 'fixed' ? 'split_debit' : 'split_block'
  const chargedSoFar: { participant_id: string; amount: number }[] = []

  for (const p of resolvedParticipants) {
    const { data: txRow } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id:        p.id,
        type:           debitType,
        amount:         amountPerPerson,
        amount_brl:     amountPerPerson,
        fee_amount:     0,
        status:         'pending',
        reference_id:   splitId,
        reference_type: 'split',
        metadata:       { split_id: splitId, split_name: name.trim(), owner_id: owner.id },
      })
      .select('id')
      .single()

    const txId = txRow?.id ?? crypto.randomUUID()

    try {
      await transferToWallet(amountPerPerson, owner.asaas_wallet_id, `Split: ${name.trim()}`, txId, p.apiKey)
      await supabaseAdmin.from('transactions').update({ status: 'completed' }).eq('id', txId)
      chargedSoFar.push({ participant_id: p.id, amount: amountPerPerson })
    } catch (e) {
      const asaasResponse = e instanceof AsaasError ? e.asaasResponse : null
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', txId)
      await logError(supabaseAdmin, 'split-create', e,
        {
          split_id: splitId, failed_participant_id: p.id,
          already_charged: chargedSoFar, // precisa de reconciliação manual se não-vazio
        },
        { asaas_response: asaasResponse },
      )
      await supabaseAdmin.from('splits').delete().eq('id', splitId)
      return err(
        'ASAAS_ERROR',
        'Falha ao processar pagamento de um dos participantes. Tente novamente. Se algum valor foi debitado, contate o suporte.',
        503,
      )
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

  // ── Notificar participantes adicionados (best-effort) ─────────────────────────

  for (const p of resolvedParticipants) {
    sendPush(
      p.id,
      'Você entrou em um Split',
      `${owner.handle} adicionou você ao split "${name.trim()}"`,
      { route: `/(app)/split/${splitId}` },
      'invite',
    ).catch(() => {})
  }

  return json({ split_id: splitId }, 201)
})
