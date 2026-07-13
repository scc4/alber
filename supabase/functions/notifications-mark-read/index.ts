// Spec: sino de notificações (transações, convites etc.)
// POST /notifications-mark-read
// Body: { ids?: string[], all?: boolean } — marca notificações do próprio
// usuário como lidas. Rotas de escrita nesse app sempre passam por Edge
// Function (mesmo padrão de lounge-set-primary, split-close etc.).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface MarkReadRequest {
  ids?: string[]
  all?: boolean
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

  let body: MarkReadRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === 'string' && id.length > 0) : []
  if (!body.all && ids.length === 0) {
    return err('MISSING_FIELDS', 'Informe ids ou all=true', 400)
  }

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Atualizar ────────────────────────────────────────────────────────────────

  let query = supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', caller.id)
    .is('read_at', null)

  if (!body.all) query = query.in('id', ids)

  const { error: updateErr } = await query

  if (updateErr) {
    await logError(supabaseAdmin, 'notifications-mark-read', updateErr, { user_id: caller.id })
    return err('DB_ERROR', 'Erro ao marcar notificações como lidas', 500)
  }

  return json({ ok: true })
})
