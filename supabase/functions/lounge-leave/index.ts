// Spec: /specs/06_modules/alber_lounge.md § 10 "Sair do Lounge"
// POST /lounge-leave
// Membro ou gestor sai voluntariamente de um Lounge (role != 'owner')

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface LeaveRequest {
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

  let body: LeaveRequest
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

  // ── Verificar membership ────────────────────────────────────────────────────

  const { data: membership } = await supabaseAdmin
    .from('space_members')
    .select('id, role, status')
    .eq('space_id', body.space_id)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!membership || membership.status !== 'active') {
    return err('NOT_MEMBER', 'Você não é membro ativo deste Lounge', 403)
  }

  if (membership.role === 'owner') {
    return err('FORBIDDEN', 'O dono não pode sair do Lounge — encerre-o para removê-lo', 403)
  }

  // ── Marcar como left, limpar is_primary ─────────────────────────────────────

  const { error: updateErr } = await supabaseAdmin
    .from('space_members')
    .update({ status: 'left', is_primary: false })
    .eq('id', membership.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'lounge-leave', updateErr, { space_id: body.space_id, caller_id: caller.id })
    return err('DB_ERROR', 'Erro ao sair do Lounge', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    caller.id,
    event_type: 'lounge_member_left',
    metadata:   { space_id: body.space_id },
  })

  return json({ success: true })
})
