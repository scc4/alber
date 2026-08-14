// Plano CNPJ (velvet-puzzling-sedgewick)
// GET /company-operators-list?company_id=...
// Lista os operadores cadastrados de uma empresa, com nome/handle e a matriz
// de permissões de cada um. Só o master (ou operador com gerenciar_operadores)
// pode ver essa lista.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { requireCompanyPermission } from '../_shared/company-permissions.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'GET') return err('METHOD_NOT_ALLOWED', 'Use GET', 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  const companyId = new URL(req.url).searchParams.get('company_id')
  if (!companyId) return err('MISSING_FIELDS', 'company_id é obrigatório', 400)

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const access = await requireCompanyPermission(supabaseAdmin, caller.id, companyId, 'gerenciar_operadores')
  if (!access.ok) return err('FORBIDDEN', 'Sem permissão para ver os operadores desta empresa', 403)

  const { data: operators, error: opErr } = await supabaseAdmin
    .from('company_operators')
    .select('id, status, permissions, joined_at, created_at, users:user_id (id, name, handle)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (opErr) return err('DB_ERROR', 'Erro ao buscar operadores', 500)

  const data = (operators ?? []).map(o => {
    const u = o.users as unknown as { id: string; name: string; handle: string } | null
    return {
      operator_id: o.id,
      user_id:     u?.id ?? null,
      name:        u?.name ?? null,
      handle:      u?.handle ?? null,
      status:      o.status,
      permissions: o.permissions,
      joined_at:   o.joined_at,
    }
  })

  return json({ operators: data })
})
