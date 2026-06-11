// Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão — Membros"
// POST /lounge-remove-member
// Dono ou admin remove membro ativo do Lounge

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface RemoveRequest {
  space_id: string   // spaces.id
  user_id:  string   // users.id do membro a remover
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: RemoveRequest
  try { body = await req.json() } catch (e) {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.space_id || !body.user_id) {
    return err('MISSING_FIELDS', 'space_id e user_id são obrigatórios', 400)
  }

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  if (body.user_id === caller.id) {
    return err('CANNOT_REMOVE_SELF', 'Não é possível remover a si mesmo', 422)
  }

  const { data: target } = await supabaseAdmin
    .from('space_members')
    .select('id, space_id, user_id, status, role')
    .eq('space_id', body.space_id)
    .eq('user_id', body.user_id)
    .maybeSingle()

  if (!target) return err('MEMBER_NOT_FOUND', 'Membro não encontrado', 404)
  if (target.status !== 'active') return err('NOT_ACTIVE', 'Membro não está ativo', 422)
  if (target.role === 'owner') return err('CANNOT_REMOVE_OWNER', 'Não é possível remover o dono do Lounge', 422)

  const { data: callerMembership } = await supabaseAdmin
    .from('space_members')
    .select('role, status')
    .eq('space_id', body.space_id)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (
    !callerMembership ||
    callerMembership.status !== 'active' ||
    !['owner', 'admin'].includes(callerMembership.role)
  ) {
    return err('FORBIDDEN', 'Sem permissão para remover membros', 403)
  }

  const { error: updateErr } = await supabaseAdmin
    .from('space_members')
    .update({ status: 'banned', is_primary: false })
    .eq('id', target.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'lounge-remove-member', updateErr, { space_id: body.space_id, user_id: body.user_id })
    return err('DB_ERROR', 'Erro ao remover membro', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    body.user_id,
    event_type: 'lounge_member_removed',
    metadata:   { space_id: body.space_id, removed_by: caller.id },
  })

  return json({ space_id: body.space_id, user_id: body.user_id })
})
