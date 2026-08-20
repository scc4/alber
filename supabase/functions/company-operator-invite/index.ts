// Plano CNPJ (velvet-puzzling-sedgewick)
// POST /company-operator-invite
// Master (ou operador com permissions.gerenciar_operadores) convida um
// usuário por @handle para operar a empresa. Cria company_operators com
// status='invited' — company-operator-join promove para 'active' quando o
// convidado aceita. Padrão espelhado em lounge-invite-handle/lounge-join.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'
import { requireCompanyPermission, isValidCompanyPermissionKey } from '../_shared/company-permissions.ts'

interface InviteRequest {
  company_id:  string
  handle:      string
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

  let body: InviteRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const handleNoAt = (body.handle ?? '').replace(/^@/, '').toLowerCase().trim()
  if (!body.company_id || !handleNoAt) {
    return err('MISSING_FIELDS', 'company_id e handle são obrigatórios', 400)
  }

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id, handle')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Validar permissão do caller para gerenciar operadores ────────────────────

  const access = await requireCompanyPermission(supabaseAdmin, caller.id, body.company_id, 'gerenciar_operadores')
  if (!access.ok || !access.company) {
    return err('FORBIDDEN', 'Sem permissão para convidar operadores', 403)
  }
  const company = access.company

  // ── Resolver handle convidado ─────────────────────────────────────────────────

  if (handleNoAt === (caller.handle ?? '').replace(/^@/, '').toLowerCase()) {
    return err('CANNOT_INVITE_SELF', 'Não é possível convidar a si mesmo', 422)
  }

  const { data: invitee } = await supabaseAdmin
    .from('users')
    .select('id, handle, name')
    .or(`handle.ilike.${handleNoAt},handle.ilike.@${handleNoAt}`)
    .maybeSingle()

  if (!invitee) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  if (invitee.id === company.owner_id) {
    return err('IS_MASTER', 'Este usuário já é o master da empresa', 422)
  }

  // ── Verificar membership existente ────────────────────────────────────────────

  const { data: existing } = await supabaseAdmin
    .from('company_operators')
    .select('id, status')
    .eq('company_id', company.id)
    .eq('user_id', invitee.id)
    .maybeSingle()

  if (existing?.status === 'active') return err('ALREADY_OPERATOR', 'Este usuário já é operador da empresa', 422)

  // ── Sanitizar matriz de permissões inicial (chaves desconhecidas são ignoradas) ─

  const initialPermissions: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(body.permissions ?? {})) {
    if (isValidCompanyPermissionKey(key)) initialPermissions[key] = value === true
  }

  const { error: inviteErr } = await supabaseAdmin
    .from('company_operators')
    .upsert(
      { company_id: company.id, user_id: invitee.id, status: 'invited', permissions: initialPermissions, joined_at: null },
      { onConflict: 'company_id,user_id' },
    )

  if (inviteErr) {
    await logError(supabaseAdmin, 'company-operator-invite', inviteErr, { company_id: company.id, invitee_id: invitee.id })
    return err('DB_ERROR', 'Erro ao convidar operador', 500)
  }

  // ── Notificar convidado ────────────────────────────────────────────────────────

  await sendPush(
    invitee.id,
    'Convite para operar uma empresa',
    `${caller.handle} te convidou para operar a conta empresa no Alber`,
    { route: `/(app)/empresas/${company.id}` },
    'invite',
  ).catch(() => {})

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    invitee.id,
      event_type: 'company_operator_invited',
      metadata:   { company_id: company.id, invited_by: caller.id },
    })
  } catch { /* não-crítico */ }

  return json({ company_id: company.id, invited_handle: invitee.handle })
})
