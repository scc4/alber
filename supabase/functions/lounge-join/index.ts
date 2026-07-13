// Spec: /specs/06_modules/alber_lounge.md § 6 "Entrada no Lounge"
// POST /lounge-join
// Público (space_id): INSERT pending → notifica dono
// Privado (invite_token): INSERT active imediato

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface LoungeJoinRequest {
  space_id?:     string
  invite_token?: string
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

  let body: LoungeJoinRequest
  try { body = await req.json() } catch (e) {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.space_id && !body.invite_token) {
    return err('MISSING_FIELDS', 'Forneça space_id ou invite_token', 400)
  }

  // ── Buscar usuário ──────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Resolver space ──────────────────────────────────────────────────────────

  type SpaceRow = { id: string; type: string; status: string; owner_id: string }

  let space: SpaceRow | null = null

  if (body.invite_token) {
    const { data } = await supabaseAdmin
      .from('spaces')
      .select('id, type, status, owner_id')
      .eq('invite_token', body.invite_token)
      .maybeSingle()
    space = data
  } else {
    const { data } = await supabaseAdmin
      .from('spaces')
      .select('id, type, status, owner_id')
      .eq('id', body.space_id!)
      .maybeSingle()
    space = data
  }

  if (!space || space.status !== 'active') {
    return err('SPACE_NOT_FOUND', 'Lounge não encontrado ou inativo', 404)
  }

  if (space.owner_id === user.id) {
    return err('ALREADY_OWNER', 'Você já é dono deste Lounge', 422)
  }

  // ── Verificar membership existente ──────────────────────────────────────────

  const { data: existing } = await supabaseAdmin
    .from('space_members')
    .select('id, status')
    .eq('space_id', space.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing?.status === 'active') {
    return err('ALREADY_MEMBER', 'Você já é membro deste Lounge', 422)
  }
  if (existing?.status === 'pending') {
    return err('REQUEST_PENDING', 'Solicitação já enviada. Aguarde aprovação.', 422)
  }

  // ── Ativação direta: via invite_token (link é a autorização) OU quando já
  // existe um convite por handle ('invited' — dono convidou, não precisa de
  // aprovação, ver lounge-invite-handle) ────────────────────────────────────────

  if (body.invite_token || existing?.status === 'invited') {
    const { error: insertErr } = await supabaseAdmin
      .from('space_members')
      .upsert(
        { space_id: space.id, user_id: user.id, role: 'member', status: 'active', is_primary: false, joined_at: new Date().toISOString() },
        { onConflict: 'space_id,user_id' },
      )

    if (insertErr) {
      await logError(supabaseAdmin, 'lounge-join', insertErr, { space_id: space.id })
      return err('DB_ERROR', 'Erro ao entrar no Lounge', 500)
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id:    user.id,
      event_type: 'lounge_joined',
      metadata:   { space_id: space.id, via: body.invite_token ? 'invite_token' : 'handle_invite' },
    })

    return json({ status: 'active', space_id: space.id })
  }

  // ── Via space_id, sem convite prévio → solicitar entrada (apenas lounges abertos)

  if (space.type !== 'open') {
    return err('INVITE_REQUIRED', 'Este Lounge é privado. Use um link de convite.', 403)
  }

  const { error: insertErr } = await supabaseAdmin
    .from('space_members')
    .upsert(
      { space_id: space.id, user_id: user.id, role: 'member', status: 'pending', is_primary: false, joined_at: null },
      { onConflict: 'space_id,user_id' },
    )

  if (insertErr) {
    await logError(supabaseAdmin, 'lounge-join', insertErr, { space_id: space.id })
    return err('DB_ERROR', 'Erro ao solicitar entrada', 500)
  }

  // Notificar dono (best-effort)
  await Promise.allSettled([
    supabaseAdmin.from('audit_logs').insert({
      user_id:    space.owner_id,
      event_type: 'lounge_join_request',
      metadata:   { space_id: space.id, requester_id: user.id },
    }),
    sendPush(
      space.owner_id,
      'Nova solicitação no Lounge',
      `${user.name ?? user.handle} quer entrar no seu Lounge.`,
      { route: `/(app)/lounge/${space.id}` },
      'invite',
    ),
  ])

  return json({ status: 'pending', space_id: space.id })
})
