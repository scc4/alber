// Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão — Convites"
// POST /lounge-invite-cancel
// Dono ou admin cancela um convite por handle ainda não aceito (status='invited')

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface CancelInviteRequest {
  space_id: string   // spaces.id
  user_id:  string   // users.id do convidado
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

  let body: CancelInviteRequest
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

  const { data: target } = await supabaseAdmin
    .from('space_members')
    .select('id, space_id, user_id, status')
    .eq('space_id', body.space_id)
    .eq('user_id', body.user_id)
    .maybeSingle()

  if (!target) return err('MEMBER_NOT_FOUND', 'Convite não encontrado', 404)
  if (target.status !== 'invited') return err('NOT_INVITED', 'Este convite não está mais pendente', 422)

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
    return err('FORBIDDEN', 'Sem permissão para cancelar convites', 403)
  }

  const { error: deleteErr } = await supabaseAdmin
    .from('space_members')
    .delete()
    .eq('id', target.id)

  if (deleteErr) {
    await logError(supabaseAdmin, 'lounge-invite-cancel', deleteErr, { space_id: body.space_id, user_id: body.user_id })
    return err('DB_ERROR', 'Erro ao cancelar convite', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    body.user_id,
    event_type: 'lounge_invite_cancelled',
    metadata:   { space_id: body.space_id, cancelled_by: caller.id },
  })

  return json({ space_id: body.space_id, user_id: body.user_id })
})
