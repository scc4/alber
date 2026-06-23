// Spec: /specs/06_modules/split.md
// POST /split-extend
// Estende o prazo de convite de um split ativo.
// Somente o dono do split pode chamar este endpoint.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface ExtendRequest {
  split_id: string
  days:     number
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ──────────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Body ──────────────────────────────────────────────────────────────────────

  let body: ExtendRequest
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { split_id, days } = body

  if (!split_id) return err('MISSING_FIELDS', 'split_id obrigatório', 400)
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return err('INVALID_DAYS', 'days deve ser inteiro entre 1 e 90', 422)
  }

  // ── Verificar split: ativo e pertence ao caller ───────────────────────────────

  const { data: split } = await supabaseAdmin
    .from('splits')
    .select('id, owner_id, status')
    .eq('id', split_id)
    .maybeSingle()

  if (!split) return err('NOT_FOUND', 'Split não encontrado', 404)
  if (split.owner_id !== caller.id) return err('FORBIDDEN', 'Somente o dono pode estender o prazo', 403)
  if (split.status !== 'open') return err('SPLIT_NOT_ACTIVE', 'Split não está ativo', 409)

  // ── Atualizar invite_expires_at ───────────────────────────────────────────────

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('splits')
    .update({ invite_expires_at: `now() + interval '${days} days'` })
    .eq('id', split_id)
    .select('invite_expires_at')
    .single()

  if (updateErr || !updated) {
    await logError(supabaseAdmin, 'split-extend', updateErr ?? new Error('update_failed'), { split_id })
    return err('DB_ERROR', 'Erro ao estender prazo', 500)
  }

  return json({ success: true, new_expires_at: updated.invite_expires_at })
})
