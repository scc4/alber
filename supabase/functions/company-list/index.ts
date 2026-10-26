// Plano CNPJ (velvet-puzzling-sedgewick)
// GET /company-list
// Lista as empresas do usuário autenticado: onde é master (companies.owner_id)
// e onde é operador ativo (company_operators).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { pollCompanyKyc } from '../_shared/company-kyc.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

export async function handleRequest(req: Request): Promise<Response> {
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

  // ── Situação do KYC: empresas pendentes do master são conferidas no Asaas ─────
  // O webhook pode não chegar (e no sandbox a aprovação é automática); sem isto, quem só olha a lista
  // (Alber Food, app) ficaria com a empresa "pendente" para sempre. Só aprova; falha não derruba a lista.
  const { data: pendingOwned } = await supabaseAdmin
    .from('companies')
    .select('id')
    .eq('owner_id', user.id)
    .in('kyc_status', ['pending', 'submitted'])
    .is('deleted_at', null)
  if (pendingOwned && pendingOwned.length > 0) {
    const sync = Promise.all(pendingOwned.slice(0, 5).map((c: { id: string }) => pollCompanyKyc(supabaseAdmin, c.id)))
    await Promise.race([sync, new Promise((resolve) => setTimeout(resolve, 8000))])
  }

  // ── Empresas onde é master ────────────────────────────────────────────────────

  const { data: ownedCompanies } = await supabaseAdmin
    .from('companies')
    .select('id, handle, company_name, trading_name, account_status, kyc_status, onboarding_url, cnpj_masked, pix_key_type')
    .eq('owner_id', user.id)

  // ── Empresas onde é operador ativo ────────────────────────────────────────────

  const { data: operatorRows } = await supabaseAdmin
    .from('company_operators')
    .select('permissions, companies:company_id (id, handle, company_name, trading_name, account_status, kyc_status, onboarding_url, cnpj_masked, pix_key_type)')
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
      pix_key_type:   c.pix_key_type,
      role:           'master' as const,
      permissions:    null,
    })),
    ...(operatorRows ?? [])
      .filter(r => r.companies)
      .map(r => {
        const c = r.companies as unknown as { id: string; handle: string; company_name: string; trading_name: string | null; account_status: string; kyc_status: string; onboarding_url: string | null; cnpj_masked: string | null; pix_key_type: string | null }
        return {
          id:             c.id,
          handle:         c.handle,
          company_name:   c.company_name,
          trading_name:   c.trading_name,
          account_status: c.account_status,
          kyc_status:     c.kyc_status,
          onboarding_url: c.onboarding_url,
          cnpj_masked:    c.cnpj_masked,
          pix_key_type:   c.pix_key_type,
          role:           'operator' as const,
          permissions:    r.permissions,
        }
      }),
  ]

  return json({ companies: result })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
