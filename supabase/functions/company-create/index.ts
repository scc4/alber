// Melhoria 1 (cadastro de empresa para quem já tem conta pessoal)
// POST /company-create { company: CreateCompanyInput }
// Requer sessão de um usuário já autenticado (JWT) — usado quando o
// responsável pela empresa já tem conta Alber (detectado via auth-check-cpf
// + login normal no app). Reaproveita a mesma lógica de auth-register para
// abrir a subconta PJ, mas sem tocar em nenhum dado pessoal: o dono já existe.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { createCompanyForOwner, CreateCompanyInput } from '../_shared/company.ts'
import { logError } from '../_shared/error-log.ts'

interface CompanyCreateRequest {
  company: CreateCompanyInput
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

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

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id, deleted_at')
    .eq('auth_id', authUser.id)
    .maybeSingle()
  if (!caller || caller.deleted_at) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Rate limit: máx 5 aberturas de empresa por IP a cada 15 minutos ──────────
  // Mesma razão do auth-register: cada chamada bem-sucedida cria uma subconta
  // real na Asaas.

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'company_create_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)

  if ((attempts ?? 0) >= 5) {
    return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  }
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    caller.id,
    event_type: 'company_create_attempt',
    ip_address: clientIp,
  })

  // ── Parse body ──────────────────────────────────────────────────────────────

  let body: CompanyCreateRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  if (!body.company) return err('MISSING_FIELDS', 'company é obrigatório', 400)

  const result = await createCompanyForOwner(supabaseAdmin, caller.id, body.company)

  if (!result.ok) {
    if (result.code === 'DB_ERROR') {
      await logError(supabaseAdmin, 'company-create', new Error(result.message), { owner_id: caller.id })
    }
    return err(result.code, result.message, result.status)
  }

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    caller.id,
      event_type: 'company_create',
      metadata:   { company_id: result.company_id },
    })
  } catch { /* não-crítico */ }

  return json({
    company_id:             result.company_id,
    company_account_status: result.account_status,
    company_kyc_status:     result.kyc_status,
    company_onboarding_url: result.onboarding_url,
  }, 201)
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
