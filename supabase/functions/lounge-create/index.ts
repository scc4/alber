// Spec: /specs/06_modules/alber_lounge.md § 4 "Criar Lounge"
// POST /lounge-create
// Autentica JWT → INSERT spaces + space_members (usuário pode ter múltiplos lounges como dono)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface LoungeCreateRequest {
  name:         string
  type:         'open' | 'closed'       // open = público, closed = privado via link
  description?: string
  skin:         { accent: string; bgDark: string }
  image_url?:   string | null
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

  let body: LoungeCreateRequest
  try { body = await req.json() } catch (e) {
    await logError(supabaseAdmin, 'lounge-create', e, {})
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { name, type, description, skin, image_url } = body

  if (!name?.trim()) return err('MISSING_FIELDS', 'name é obrigatório', 400)
  if (!['open', 'closed'].includes(type)) {
    return err('INVALID_TYPE', "type deve ser 'open' ou 'closed'", 400)
  }

  // ── Buscar usuário ──────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Gerar invite_token para lounges privados ─────────────────────────────────

  const invite_token = type === 'closed' ? crypto.randomUUID() : null

  // ── Inserir space ──────────────────────────────────────────────────────────

  const { data: space, error: spaceErr } = await supabaseAdmin
    .from('spaces')
    .insert({
      name:         name.trim(),
      type,
      description:  description?.trim() ?? null,
      image_url:    image_url ?? null,
      owner_id:     user.id,
      skin:         skin ?? { accent: '#5BCEC9', bgDark: '#050a0c' },
      invite_token,
      status:       'active',
    })
    .select('id, name, type, skin, invite_token, created_at')
    .single()

  if (spaceErr || !space) {
    await logError(supabaseAdmin, 'lounge-create', spaceErr ?? new Error('space_insert_failed'), { name })
    return err('DB_ERROR', 'Erro ao criar Lounge', 500)
  }

  // ── Adicionar dono como membro ativo ───────────────────────────────────────

  const { error: memberErr } = await supabaseAdmin
    .from('space_members')
    .insert({
      space_id:  space.id,
      user_id:   user.id,
      role:      'owner',
      status:    'active',
      joined_at: new Date().toISOString(),
    })

  if (memberErr) {
    await supabaseAdmin.from('spaces').delete().eq('id', space.id)
    await logError(supabaseAdmin, 'lounge-create', memberErr, { space_id: space.id })
    return err('DB_ERROR', 'Erro ao configurar Lounge', 500)
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    user.id,
    event_type: 'lounge_created',
    metadata:   { space_id: space.id, name, type },
  })

  return json({
    space_id:     space.id,
    name:         space.name,
    type:         space.type,
    skin:         space.skin,
    invite_token: space.invite_token,
    created_at:   space.created_at,
  })
})
