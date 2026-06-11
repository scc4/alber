// Spec: /specs/06_modules/alber_lounge.md § 6 "Entrada no Lounge — Privado"
// POST /lounge-invite-preview
// Qualquer usuário autenticado pode ver o preview do lounge via invite_token
// Usa service role para ler espaços privados (RLS bloqueia não-membros)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

interface PreviewRequest {
  invite_token: string
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

  let body: PreviewRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.invite_token) return err('MISSING_FIELDS', 'invite_token é obrigatório', 400)

  // ── Buscar lounge pelo token ─────────────────────────────────────────────────

  const { data: space } = await supabaseAdmin
    .from('spaces')
    .select('id, name, description, type, skin, image_url, status')
    .eq('invite_token', body.invite_token)
    .maybeSingle()

  if (!space || space.status !== 'active') {
    return err('INVITE_NOT_FOUND', 'Link de convite inválido ou expirado', 404)
  }

  // ── Contar membros ativos ───────────────────────────────────────────────────

  const { count: memberCount } = await supabaseAdmin
    .from('space_members')
    .select('id', { count: 'exact', head: true })
    .eq('space_id', space.id)
    .eq('status', 'active')

  return json({
    id:           space.id,
    name:         space.name,
    description:  space.description ?? null,
    type:         space.type,
    skin:         space.skin ?? {},
    image_url:    space.image_url ?? null,
    member_count: memberCount ?? 0,
  })
})
