// Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão"
// PATCH /lounge-update-visual
// Atualiza image_url e skin.accent do lounge — apenas owner ou manager.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

interface UpdateVisualRequest {
  space_id:   string
  accent?:    string
  image_url?: string | null
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

  // ── Body ────────────────────────────────────────────────────────────────────

  let body: UpdateVisualRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { space_id, accent, image_url } = body
  if (!space_id) return err('MISSING_FIELDS', 'space_id é obrigatório', 400)

  // ── Buscar usuário ──────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Verificar permissão: owner ou manager do lounge ─────────────────────────

  const { data: membership } = await supabaseAdmin
    .from('space_members')
    .select('role')
    .eq('space_id', space_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return err('FORBIDDEN', 'Apenas owner ou manager pode editar o visual', 403)
  }

  // ── Buscar skin atual para merge ────────────────────────────────────────────

  const { data: space } = await supabaseAdmin
    .from('spaces')
    .select('skin')
    .eq('id', space_id)
    .maybeSingle()

  if (!space) return err('NOT_FOUND', 'Lounge não encontrado', 404)

  const currentSkin = (space.skin as Record<string, unknown>) ?? {}

  // ── Montar patch ─────────────────────────────────────────────────────────────

  const patch: Record<string, unknown> = {}

  if (accent !== undefined) {
    patch.skin = { ...currentSkin, accent }
  }

  // image_url: undefined = não alterar, null = remover, string = atualizar
  if (image_url !== undefined) {
    patch.image_url = image_url
  }

  if (Object.keys(patch).length === 0) {
    return json({ space_id, updated: false })
  }

  const { error: updateErr } = await supabaseAdmin
    .from('spaces')
    .update(patch)
    .eq('id', space_id)

  if (updateErr) {
    return err('DB_ERROR', 'Erro ao atualizar visual', 500)
  }

  return json({ space_id, updated: true })
})
