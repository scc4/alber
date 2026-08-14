// Plano CNPJ (velvet-puzzling-sedgewick)
// POST /company-invite-link-create
// Master (ou operador com gerenciar_operadores) gera um link de convite para
// alguém que nunca usou o Alber — diferente de company-operator-invite
// (que exige @handle de quem já tem conta).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { requireCompanyPermission, isValidCompanyPermissionKey } from '../_shared/company-permissions.ts'

const INVITE_EXPIRATION_DAYS = 7

interface CreateLinkRequest {
  company_id:  string
  permissions?: Record<string, boolean>
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

  let body: CreateLinkRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }
  if (!body.company_id) return err('MISSING_FIELDS', 'company_id é obrigatório', 400)

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()
  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const access = await requireCompanyPermission(supabaseAdmin, caller.id, body.company_id, 'gerenciar_operadores')
  if (!access.ok) return err('FORBIDDEN', 'Sem permissão para convidar operadores', 403)

  const sanitized: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(body.permissions ?? {})) {
    if (isValidCompanyPermissionKey(key)) sanitized[key] = value === true
  }

  const token = crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + INVITE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { error: insertErr } = await supabaseAdmin
    .from('company_invites')
    .insert({
      company_id: body.company_id,
      token,
      permissions: sanitized,
      created_by: caller.id,
      expires_at: expiresAt,
    })

  if (insertErr) return err('DB_ERROR', 'Erro ao criar convite', 500)

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    caller.id,
    event_type: 'company_invite_link_created',
    metadata:   { company_id: body.company_id },
  }).catch(() => {})

  return json({ token, expires_at: expiresAt }, 201)
})
