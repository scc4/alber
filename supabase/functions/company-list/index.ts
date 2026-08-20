// Plano CNPJ (velvet-puzzling-sedgewick)
// GET /company-list
// Lista as empresas do usuário autenticado: onde é master (companies.owner_id)
// e onde é operador ativo (company_operators).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

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

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Empresas onde é master ────────────────────────────────────────────────────

  const { data: ownedCompanies } = await supabaseAdmin
    .from('companies')
    .select('id, handle, company_name, trading_name, account_status, kyc_status, onboarding_url, cnpj_masked')
    .eq('owner_id', user.id)

  // ── Empresas onde é operador ativo ────────────────────────────────────────────

  const { data: operatorRows } = await supabaseAdmin
    .from('company_operators')
    .select('permissions, companies:company_id (id, handle, company_name, trading_name, account_status, kyc_status, onboarding_url, cnpj_masked)')
    .eq('user_id', user.id)
    .eq('status', 'active')

  const result = [
    ...(ownedCompanies ?? []).map(c => ({
      id:             c.id,
      handle:         c.handle,
      company_name:   c.company_name,
      trading_name:   c.trading_name,
      account_status: c.account_status,
      kyc_status:     c.kyc_status,
      onboarding_url: c.onboarding_url,
      cnpj_masked:    c.cnpj_masked,
      role:           'master' as const,
      permissions:    null,
    })),
    ...(operatorRows ?? [])
      .filter(r => r.companies)
      .map(r => {
        const c = r.companies as unknown as { id: string; handle: string; company_name: string; trading_name: string | null; account_status: string; kyc_status: string; onboarding_url: string | null; cnpj_masked: string | null }
        return {
          id:             c.id,
          handle:         c.handle,
          company_name:   c.company_name,
          trading_name:   c.trading_name,
          account_status: c.account_status,
          kyc_status:     c.kyc_status,
          onboarding_url: c.onboarding_url,
          cnpj_masked:    c.cnpj_masked,
          role:           'operator' as const,
          permissions:    r.permissions,
        }
      }),
  ]

  return json({ companies: result })
})
