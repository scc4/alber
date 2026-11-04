// POST /food-company-limit-cancel   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário)
//   { company_id, owner_ref } -> 200 { status: 'cancelled' }   |   404 LIMIT_REQUEST_NOT_FOUND se não há pedido em aberto
//
// Cancela o pedido de aumento de limite em aberto da empresa (o mesmo resumo que company-limit-request devolve ao cancelar).
// Regras em _shared/limit-request.ts.

import { handleCors, json, err } from '../_shared/cors.ts'
import { cancelLimitRequest } from '../_shared/limit-request.ts'
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

  const outcome = await cancelLimitRequest(supabaseAdmin, loaded.company, { ownerRef: ids.ownerRef })
  if (!outcome.ok) return err(outcome.code, outcome.message, outcome.status, outcome.extra)
  return json(outcome.body, outcome.status)
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
