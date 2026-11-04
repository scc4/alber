// POST /food-company-limit-request   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário)
//   { company_id, owner_ref, per_tx_brl, per_day_brl, reason }
//   -> 201 { request: { id, status, requested_per_tx_brl, requested_per_day_brl, current_per_tx_brl, current_per_day_brl, created_at } }
//
// O dono PEDE o aumento do limite de saque da empresa; a equipe do Alber decide no Alber Admin (public.admin_decide_limit_request). Mesmas
// regras e mesmo resumo de company-limit-request (app), em _shared/limit-request.ts. Os limites vão em REAIS (per_tx_brl / per_day_brl), como
// o resto do módulo de limites; só o saque e o saldo usam centavos. O pedido guarda o dono em requested_by_ref (não há usuário do app).
// Erros: COMPANY_NOT_APPROVED (422), OWNER_LINK_PENDING / OWNER_LINK_REJECTED (403), LIMIT_INVALID, LIMIT_ABOVE_CAP, REASON_INVALID,
// LIMIT_NOT_HIGHER (422), LIMIT_REQUEST_PENDING (409), RATE_LIMITED (429), NOT_OWNER (403).

import { handleCors, json, err } from '../_shared/cors.ts'
import { createLimitRequest } from '../_shared/limit-request.ts'
import { adminClient, loadOwnedCompany, readIds, readServiceBody } from '../_shared/food-company.ts'

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const ids = readIds(parsed.body)
  if (!ids.ok) return ids.res

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
  if (!loaded.ok) return loaded.res

  const outcome = await createLimitRequest(supabaseAdmin, loaded.company, { ownerRef: ids.ownerRef }, parsed.body)
  if (!outcome.ok) return err(outcome.code, outcome.message, outcome.status, outcome.extra)
  return json(outcome.body, outcome.status)
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
