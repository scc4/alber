// Plano CNPJ (velvet-puzzling-sedgewick)
// POST /company-operator-set-permissions
// Master (ou operador com permissions.gerenciar_operadores) liga/desliga
// chaves da matriz de permissões de um operador. Merge parcial — só as
// chaves enviadas são alteradas, o resto permanece como estava.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { requireCompanyPermission, isValidCompanyPermissionKey } from '../_shared/company-permissions.ts'

interface SetPermissionsRequest {
  company_id:       string
  operator_user_id: string
  permissions:      Record<string, boolean>
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

  let body: SetPermissionsRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.company_id || !body.operator_user_id || !body.permissions || typeof body.permissions !== 'object') {
    return err('MISSING_FIELDS', 'company_id, operator_user_id e permissions são obrigatórios', 400)
  }

  const unknownKeys = Object.keys(body.permissions).filter(k => !isValidCompanyPermissionKey(k))
  if (unknownKeys.length > 0) {
    return err('INVALID_PERMISSION_KEY', `Chave(s) de permissão desconhecida(s): ${unknownKeys.join(', ')}`, 400)
  }

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Validar permissão do caller para gerenciar operadores ────────────────────

  const access = await requireCompanyPermission(supabaseAdmin, caller.id, body.company_id, 'gerenciar_operadores')
  if (!access.ok || !access.company) {
    return err('FORBIDDEN', 'Sem permissão para gerenciar operadores', 403)
  }

  // ── Buscar operador alvo ──────────────────────────────────────────────────────

  const { data: operator } = await supabaseAdmin
    .from('company_operators')
    .select('id, permissions')
    .eq('company_id', body.company_id)
    .eq('user_id', body.operator_user_id)
    .maybeSingle()

  if (!operator) return err('OPERATOR_NOT_FOUND', 'Operador não encontrado nesta empresa', 404)

  const sanitized: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(body.permissions)) {
    sanitized[key] = value === true
  }

  const mergedPermissions = { ...(operator.permissions ?? {}), ...sanitized }

  const { error: updateErr } = await supabaseAdmin
    .from('company_operators')
    .update({ permissions: mergedPermissions })
    .eq('id', operator.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'company-operator-set-permissions', updateErr, {
      company_id: body.company_id, operator_user_id: body.operator_user_id,
    })
    return err('DB_ERROR', 'Erro ao atualizar permissões', 500)
  }

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    caller.id,
      event_type: 'company_operator_permissions_updated',
      metadata:   { company_id: body.company_id, operator_user_id: body.operator_user_id, permissions: sanitized },
    })
  } catch { /* não-crítico */ }

  return json({ company_id: body.company_id, operator_user_id: body.operator_user_id, permissions: mergedPermissions })
})
