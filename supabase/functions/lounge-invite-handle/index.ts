// Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão — Membros"
// POST /lounge-invite-handle
// Dono ou admin convida um usuário por @handle (paralelo ao link/token).
// Cria space_members com status='invited' — direção oposta a 'pending'
// (que significa "usuário pediu para entrar"). lounge-join promove
// 'invited' para 'active' quando o convidado aceita (ver lounge-join).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface InviteRequest {
  space_id: string
  handle:   string
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ────────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Parse body ──────────────────────────────────────────────────────────────

  let body: InviteRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const handleNoAt = (body.handle ?? '').replace(/^@/, '').toLowerCase().trim()
  if (!body.space_id || !handleNoAt) {
    return err('MISSING_FIELDS', 'space_id e handle são obrigatórios', 400)
  }

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id, handle')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Buscar space + validar permissão do caller ───────────────────────────────

  const { data: space } = await supabaseAdmin
    .from('spaces')
    .select('id, name, type, status, invite_token')
    .eq('id', body.space_id)
    .maybeSingle()

  if (!space || space.status !== 'active') {
    return err('SPACE_NOT_FOUND', 'Lounge não encontrado ou inativo', 404)
  }

  const { data: callerMembership } = await supabaseAdmin
    .from('space_members')
    .select('role, status')
    .eq('space_id', space.id)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (
    !callerMembership ||
    callerMembership.status !== 'active' ||
    !['owner', 'admin'].includes(callerMembership.role)
  ) {
    return err('FORBIDDEN', 'Sem permissão para convidar membros', 403)
  }

  // ── Resolver handle convidado ─────────────────────────────────────────────────

  if (handleNoAt === (caller.handle ?? '').replace(/^@/, '').toLowerCase()) {
    return err('CANNOT_INVITE_SELF', 'Não é possível convidar a si mesmo', 422)
  }

  const { data: invitee } = await supabaseAdmin
    .from('users')
    .select('id, handle, name')
    .or(`handle.ilike.${handleNoAt},handle.ilike.@${handleNoAt}`)
    .maybeSingle()

  if (!invitee) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Verificar membership existente ────────────────────────────────────────────

  const { data: existing } = await supabaseAdmin
    .from('space_members')
    .select('id, status')
    .eq('space_id', space.id)
    .eq('user_id', invitee.id)
    .maybeSingle()

  if (existing?.status === 'active') return err('ALREADY_MEMBER', 'Este usuário já é membro do Lounge', 422)
  if (existing?.status === 'pending') {
    return err('HAS_JOIN_REQUEST', 'Este usuário já pediu para entrar — aprove a solicitação em vez de convidar', 422)
  }

  // 'invited' já existente → apenas reenvia o push (idempotente); senão, cria o convite
  if (existing?.status !== 'invited') {
    const { error: inviteErr } = await supabaseAdmin
      .from('space_members')
      .upsert(
        { space_id: space.id, user_id: invitee.id, role: 'member', status: 'invited', is_primary: false, joined_at: null },
        { onConflict: 'space_id,user_id' },
      )

    if (inviteErr) {
      await logError(supabaseAdmin, 'lounge-invite-handle', inviteErr, { space_id: space.id, invitee_id: invitee.id })
      return err('DB_ERROR', 'Erro ao convidar usuário', 500)
    }
  }

  // ── Notificar convidado ────────────────────────────────────────────────────────

  const route = space.type === 'closed' && space.invite_token
    ? `/(app)/lounge/convite/${space.invite_token}`
    : `/(app)/lounge/${space.id}`

  await sendPush(
    invitee.id,
    'Convite para Lounge',
    `${caller.handle} te convidou pro Lounge "${space.name}"`,
    { route },
    'invite',
  ).catch(() => {})

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    invitee.id,
      event_type: 'lounge_invited',
      metadata:   { space_id: space.id, invited_by: caller.id },
    })
  } catch { /* não-crítico */ }

  return json({ space_id: space.id, invited_handle: invitee.handle })
})
