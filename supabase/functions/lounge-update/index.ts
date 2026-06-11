// Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão" / § 2 "Dono"
// POST /lounge-update
// Apenas o dono pode atualizar nome e descrição do Lounge

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface UpdateRequest {
  space_id:     string
  name?:        string
  description?: string
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

  let body: UpdateRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.space_id) return err('MISSING_FIELDS', 'space_id é obrigatório', 400)

  const name        = body.name        !== undefined ? body.name.trim()        : undefined
  const description = body.description !== undefined ? body.description.trim() : undefined

  if (name !== undefined) {
    if (name.length < 3)  return err('NAME_TOO_SHORT', 'Nome deve ter pelo menos 3 caracteres', 422)
    if (name.length > 50) return err('NAME_TOO_LONG',  'Nome deve ter no máximo 50 caracteres', 422)
  }

  if (name === undefined && description === undefined) {
    return err('NOTHING_TO_UPDATE', 'Nenhum campo para atualizar', 400)
  }

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
    .select('id, name, description, owner_id, status')
    .eq('id', body.space_id)
    .maybeSingle()

  if (!space || space.status === 'deleted') return err('NOT_FOUND', 'Lounge não encontrado', 404)
  if (space.owner_id !== caller.id) return err('FORBIDDEN', 'Apenas o dono pode editar nome e descrição', 403)

  // ── Montar patch ─────────────────────────────────────────────────────────────

  const patch: Record<string, unknown> = {}
  if (name !== undefined)        patch.name        = name
  if (description !== undefined) patch.description = description

  const { error: updateErr } = await supabaseAdmin
    .from('spaces')
    .update(patch)
    .eq('id', body.space_id)

  if (updateErr) {
    await logError(supabaseAdmin, 'lounge-update', updateErr, { space_id: body.space_id })
    return err('DB_ERROR', 'Erro ao atualizar Lounge', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    caller.id,
    event_type: 'lounge_updated',
    metadata:   { space_id: body.space_id, changed: Object.keys(patch) },
  })

  return json({
    success:     true,
    name:        name        ?? space.name,
    description: description ?? space.description ?? null,
  })
})
