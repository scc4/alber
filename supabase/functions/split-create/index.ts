// Spec: /specs/06_modules/split.md §3, §6
// Cria split fixo ou variável.
// Fixed: blocked_amount do dono = 0 (dono é recebedor, não paga via split).
// Variable: quota do dono é bloqueada virtualmente (sem TX Asaas — dinheiro fica na subconta).

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
  invite_expires_at:   string   // ISO timestamp
  participant_handles?: string[] // pré-convite opcional — só dispara notificação, não registra participante
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

  const { name, type, target_amount, max_participants, invite_expires_at, participant_handles } = body

  if (!name?.trim())
    return err('MISSING_FIELDS', 'Nome do split é obrigatório', 400)
  if (!['fixed', 'variable'].includes(type))
    return err('INVALID_TYPE', 'Tipo deve ser fixed ou variable', 400)
  if (typeof target_amount !== 'number' || target_amount <= 0)
    return err('INVALID_AMOUNT', 'Valor deve ser maior que zero', 400)
  if (typeof max_participants !== 'number' || max_participants < 2)
    return err('INVALID_PARTICIPANTS', 'Mínimo 2 participantes incluindo o dono', 400)
  if (!invite_expires_at || isNaN(Date.parse(invite_expires_at)))
    return err('INVALID_EXPIRY', 'Data de expiração inválida', 400)
  if (new Date(invite_expires_at) <= new Date())
    return err('INVALID_EXPIRY', 'Data de expiração deve ser no futuro', 400)

  // ── Buscar dono ───────────────────────────────────────────────────────────────

  const { data: owner, error: ownerErr } = await supabaseAdmin
    .from('users')
    .select('id, handle, asaas_api_key_enc')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (ownerErr || !owner) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Variable: verificar saldo do dono para bloquear quota ────────────────────

  const ownerBlock = parseFloat((target_amount / max_participants).toFixed(2))

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

    if (ownerBalance < ownerBlock) {
      return err(
        'INSUFFICIENT_BALANCE',
        `Saldo insuficiente. Necessário: ${ownerBlock.toFixed(2)} Albers`,
        422,
      )
    }
  }

  // ── Criar split ───────────────────────────────────────────────────────────────

  const inviteToken = crypto.randomUUID()

  const { data: split, error: splitErr } = await supabaseAdmin
    .from('splits')
    .insert({
      owner_id:         owner.id,
      name:             name.trim(),
      type,
      target_amount,
      invite_token:     inviteToken,
      invite_expires_at,
      max_participants,
      status:           'open',
    })
    .select('id')
    .single()

  if (splitErr || !split) {
    await logError(supabaseAdmin, 'split-create', splitErr ?? new Error('split_insert_failed'), { owner_id: owner.id })
    return err('DB_ERROR', 'Erro ao criar split', 500)
  }

  const splitId = split.id

  // ── Registrar dono como 1o participante ───────────────────────────────────────
  // Fixed: dono é recebedor — blocked_amount = 0, não paga via split.
  // Variable: quota bloqueada virtualmente (dinheiro permanece na subconta Asaas).

  const { error: partErr } = await supabaseAdmin
    .from('split_participants')
    .insert({
      split_id:       splitId,
      user_id:        owner.id,
      status:         'accepted',
      blocked_amount: type === 'variable' ? ownerBlock : 0,
      joined_at:      new Date().toISOString(),
    })

  if (partErr) {
    await logError(supabaseAdmin, 'split-create', partErr, { split_id: splitId })
    await supabaseAdmin.from('splits').delete().eq('id', splitId)
    return err('DB_ERROR', 'Erro ao registrar participante', 500)
  }

  // ── Registrar split_block do dono (variável) ──────────────────────────────────

  if (type === 'variable' && ownerBlock > 0) {
    await supabaseAdmin.from('transactions').insert({
      user_id:        owner.id,
      type:           'split_block',
      amount:         ownerBlock,
      amount_brl:     ownerBlock,
      fee_amount:     0,
      status:         'completed',
      reference_id:   splitId,
      reference_type: 'split',
      metadata:       { split_id: splitId, split_name: name.trim() },
    }).catch(e => console.error('[split-create] split_block tx failed (non-critical):', e))
  }

  // ── Audit log ─────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    owner.id,
    event_type: 'split_created',
    metadata:   { split_id: splitId, type, target_amount, max_participants },
  }).catch(() => {})

  const inviteUrl = `alber://split/convite/${inviteToken}`

  // ── Pré-convite por handle (opcional) ─────────────────────────────────────────
  // Registra o convidado como participante "pending" (spec §5 — ⏳ aguardando)
  // e notifica. split-join trata uma linha "pending" existente como upgrade
  // para "accepted" em vez de rejeitar (ver split-join/index.ts).

  const invitedHandles:  string[] = []
  const notFoundHandles: string[] = []

  if (Array.isArray(participant_handles) && participant_handles.length > 0) {
    const ownerHandleNoAt = (owner.handle ?? '').replace(/^@/, '').toLowerCase()
    const seen = new Set<string>([ownerHandleNoAt])
    const cap = Math.max(0, max_participants - 1)

    const uniqueHandles = participant_handles
      .map(h => (h ?? '').replace(/^@/, '').toLowerCase().trim())
      .filter(h => h.length > 0 && !seen.has(h) && seen.add(h))
      .slice(0, cap)

    for (const handleNoAt of uniqueHandles) {
      const { data: invitee } = await supabaseAdmin
        .from('users')
        .select('id, handle')
        .or(`handle.ilike.${handleNoAt},handle.ilike.@${handleNoAt}`)
        .maybeSingle()

      if (!invitee) {
        notFoundHandles.push(handleNoAt)
        continue
      }

      const { error: pendingErr } = await supabaseAdmin
        .from('split_participants')
        .insert({
          split_id:       splitId,
          user_id:        invitee.id,
          status:         'pending',
          blocked_amount: 0,
          joined_at:      null,
        })

      if (pendingErr) {
        await logError(supabaseAdmin, 'split-create', pendingErr, { split_id: splitId, invitee_id: invitee.id })
        notFoundHandles.push(handleNoAt)
        continue
      }

      invitedHandles.push(invitee.handle)
      sendPush(
        invitee.id,
        'Convite para Split',
        `${owner.handle} te convidou pro split "${name.trim()}"`,
        { route: `/(app)/split/convite/${inviteToken}` },
        'invite',
      ).catch(() => {})
    }
  }

  return json({
    split_id:           splitId,
    invite_token:       inviteToken,
    invite_url:         inviteUrl,
    invited_handles:    invitedHandles,
    not_found_handles:  notFoundHandles,
  }, 201)
})
