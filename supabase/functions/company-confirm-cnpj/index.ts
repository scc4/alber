// POST /company-confirm-cnpj { company_id, cnpj }
// Empresas cadastradas antes da migration 047 não têm companies.cnpj_masked
// salvo (companies.cnpj só guarda o hash SHA-256 — nunca dá pra recuperar
// automaticamente). Esta função deixa master ou operador ativo confirmar o
// CNPJ: se o hash bater com o que já está cadastrado, calcula e persiste a
// versão mascarada — nunca o CNPJ em texto puro.
//
// Autorização: mesma regra de quem já enxerga cnpj_masked hoje (company-list)
// — master OU operador com linha ativa, sem exigir uma permission key
// específica (não é uma ação financeira nem sensível o suficiente pra isso).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCnpj, normalizeCnpj, maskCnpjForDisplay } from '../_shared/cnpj.ts'
import { sha256hex } from '../_shared/crypto.ts'

interface ConfirmCnpjRequest {
  company_id: string
  cnpj: string
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: ConfirmCnpjRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  if (!body.company_id) return err('MISSING_FIELDS', 'company_id é obrigatório', 400)

  const cnpjClean = normalizeCnpj(body.cnpj ?? '')
  if (!validateCnpj(cnpjClean)) return err('CNPJ_INVALID', 'CNPJ inválido', 422)

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, cnpj')
    .eq('id', body.company_id)
    .maybeSingle()

  if (!company) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)

  let authorized = company.owner_id === caller.id
  if (!authorized) {
    const { data: operator } = await supabaseAdmin
      .from('company_operators')
      .select('id')
      .eq('company_id', company.id)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()
    authorized = !!operator
  }
  if (!authorized) return err('FORBIDDEN', 'Sem permissão para esta empresa', 403)

  // ── Rate limit: máx 10 tentativas por IP a cada 15 minutos ──────────────────

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'confirm_cnpj_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)

  if ((attempts ?? 0) >= 10) {
    return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  }
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    caller.id,
    event_type: 'confirm_cnpj_attempt',
    ip_address: clientIp,
  })

  const cnpjHash = await sha256hex(cnpjClean)
  if (cnpjHash !== company.cnpj) return err('CNPJ_MISMATCH', 'CNPJ não confere com o cadastrado', 422)

  const cnpjMasked = maskCnpjForDisplay(cnpjClean)
  const { error: updateErr } = await supabaseAdmin
    .from('companies')
    .update({ cnpj_masked: cnpjMasked })
    .eq('id', company.id)

  if (updateErr) return err('DB_ERROR', 'Erro ao salvar confirmação', 500)

  return json({ cnpj_masked: cnpjMasked })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
