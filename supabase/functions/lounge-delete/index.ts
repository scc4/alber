// Spec: /specs/06_modules/alber_lounge.md § 10 "Excluir Lounge"
// POST /lounge-delete
// Dono encerra o Lounge: soft delete + notifica todos os membros

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface DeleteRequest {
  space_id: string
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

  let body: DeleteRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.space_id) return err('MISSING_FIELDS', 'space_id é obrigatório', 400)

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Verificar que caller é owner ────────────────────────────────────────────

  const { data: space } = await supabaseAdmin
    .from('spaces')
    .select('id, name, owner_id, status')
    .eq('id', body.space_id)
    .maybeSingle()

  if (!space) return err('SPACE_NOT_FOUND', 'Lounge não encontrado', 404)
  if (space.status === 'deleted') return err('ALREADY_DELETED', 'Este Lounge já foi encerrado', 422)
  if (space.owner_id !== caller.id) return err('FORBIDDEN', 'Apenas o dono pode encerrar o Lounge', 403)

  // ── Buscar membros ativos para notificar (excluindo o próprio dono) ──────────

  const { data: activeMembers } = await supabaseAdmin
    .from('space_members')
    .select('user_id')
    .eq('space_id', body.space_id)
    .eq('status', 'active')
    .neq('user_id', caller.id)

  // ── Soft delete do space + desativar todos os membros ───────────────────────

  const [deleteSpaceErr, updateMembersErr] = await Promise.all([
    supabaseAdmin
      .from('spaces')
      .update({ status: 'deleted' })
      .eq('id', body.space_id)
      .then(r => r.error),
    supabaseAdmin
      .from('space_members')
      .update({ status: 'left', is_primary: false })
      .eq('space_id', body.space_id)
      .then(r => r.error),
  ])

  if (deleteSpaceErr) {
    await logError(supabaseAdmin, 'lounge-delete', deleteSpaceErr, { space_id: body.space_id })
    return err('DB_ERROR', 'Erro ao encerrar o Lounge', 500)
  }

  if (updateMembersErr) {
    await logError(supabaseAdmin, 'lounge-delete', updateMembersErr, { space_id: body.space_id })
  }

  // ── Notificações + audit log (best-effort) ──────────────────────────────────

  const pushPromises = (activeMembers ?? []).map(m =>
    sendPush(
      m.user_id,
      'Lounge encerrado',
      `${space.name} foi encerrado pelo dono.`,
    )
  )

  await Promise.allSettled([
    ...pushPromises,
    supabaseAdmin.from('audit_logs').insert({
      user_id:    caller.id,
      event_type: 'lounge_deleted',
      metadata:   { space_id: body.space_id, space_name: space.name, notified_count: (activeMembers ?? []).length },
    }),
  ])

  return json({ success: true })
})
