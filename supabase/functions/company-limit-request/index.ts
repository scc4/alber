// POST /company-limit-request
//   Pedir:    { company_id, per_tx_brl, per_day_brl, reason }
//   Cancelar: { company_id, cancel: true }
// O dono (master) PEDE o aumento do limite de saque da empresa; a equipe do Alber decide no Alber Admin (public.admin_decide_limit_request).
// Só empresa aprovada no KYC e com o vínculo do responsável em ordem pede (vínculo em revisão ou recusado já bloqueia saque, então aumento
// de limite não adianta). Um pedido aberto por empresa; 3 pedidos por dia. O aprovado substitui os limites padrão (withdraw-guard.ts).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0'
import { handleCors, json, err } from '../_shared/cors.ts'
import { cancelLimitRequest, createLimitRequest } from '../_shared/limit-request.ts'

interface LimitRequestBody {
  company_id?: string
  per_tx_brl?: unknown
  per_day_brl?: unknown
  reason?: unknown
  cancel?: unknown
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)
  const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: LimitRequestBody
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  if (!body.company_id) return err('MISSING_FIELDS', 'company_id é obrigatório', 400)

  const { data: caller } = await supabaseAdmin.from('users').select('id, deleted_at').eq('auth_id', authUser.id).maybeSingle()
  if (!caller || caller.deleted_at) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, kyc_status, kyc_approved_at, owner_link_review, deleted_at, withdraw_limit_per_tx_brl, withdraw_limit_per_day_brl')
    .eq('id', body.company_id)
    .maybeSingle()
  if (!company || company.deleted_at) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)
  // Só o master: um operador não pede aumento de limite.
  if (company.owner_id !== caller.id) return err('FORBIDDEN', 'Só o master pede aumento do limite da empresa', 403)

  // O resto das regras (cancelar e pedir) é compartilhado com o Alber Food: _shared/limit-request.ts.
  const actor = { userId: caller.id as string }
  const outcome = body.cancel === true
    ? await cancelLimitRequest(supabaseAdmin, company, actor)
    : await createLimitRequest(supabaseAdmin, company, actor, body)
  if (!outcome.ok) return err(outcome.code, outcome.message, outcome.status, outcome.extra)
  return json(outcome.body, outcome.status)
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
