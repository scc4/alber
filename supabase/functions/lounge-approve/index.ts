// Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão — Membros"
// POST /lounge-approve
// Dono ou admin aprova/recusa solicitação de entrada

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface ApproveRequest {
  member_id: string   // space_members.id
  approved:  boolean
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

  let body: ApproveRequest
  try { body = await req.json() } catch (e) {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.member_id || typeof body.approved !== 'boolean') {
    return err('MISSING_FIELDS', 'member_id e approved são obrigatórios', 400)
  }

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Buscar membership alvo ──────────────────────────────────────────────────

  const { data: target } = await supabaseAdmin
    .from('space_members')
    .select('id, space_id, user_id, status')
    .eq('id', body.member_id)
    .maybeSingle()

  if (!target) return err('MEMBER_NOT_FOUND', 'Solicitação não encontrada', 404)
  if (target.status !== 'pending') {
    return err('NOT_PENDING', 'Esta solicitação já foi processada', 422)
  }

  // ── Verificar permissão: caller é owner ou admin do space ───────────────────

  const { data: callerMembership } = await supabaseAdmin
    .from('space_members')
    .select('role, status')
    .eq('space_id', target.space_id)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (
    !callerMembership ||
    callerMembership.status !== 'active' ||
    !['owner', 'admin'].includes(callerMembership.role)
  ) {
    return err('FORBIDDEN', 'Sem permissão para gerenciar membros', 403)
  }

  // ── Atualizar status ────────────────────────────────────────────────────────

  const newStatus  = body.approved ? 'active' : 'banned'
  const joined_at  = body.approved ? new Date().toISOString() : null

  const { error: updateErr } = await supabaseAdmin
    .from('space_members')
    .update({ status: newStatus, joined_at })
    .eq('id', body.member_id)

  if (updateErr) {
    await logError(supabaseAdmin, 'lounge-approve', updateErr, { member_id: body.member_id })
    return err('DB_ERROR', 'Erro ao processar solicitação', 500)
  }

  // ── Audit log (push real quando push_tokens estiver no schema) ───────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    target.user_id,
    event_type: body.approved ? 'lounge_request_approved' : 'lounge_request_rejected',
    metadata:   { space_id: target.space_id, approved_by: caller.id },
  })

  return json({ status: newStatus, member_id: body.member_id, space_id: target.space_id })
})
