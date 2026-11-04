// POST /food-company-balance   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário)
//   { company_id, owner_ref } -> { balance_cents, generated_at }
//
// Saldo da subconta do restaurante, somente leitura. O extrato continua em takeaway-company-statement. A chave da subconta fica aqui
// (cifrada em companies) e nunca sai. Só empresa com KYC aprovado.

import { handleCors, json, err } from '../_shared/cors.ts'
import { getParentBalanceCents } from '../_shared/asaas.ts'
import { decryptSubaccountKey } from '../_shared/subaccount-key.ts'
import { logError } from '../_shared/error-log.ts'
import { adminClient, isOperational, loadOwnedCompany, notApproved, readIds, readServiceBody } from '../_shared/food-company.ts'

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const ids = readIds(parsed.body)
  if (!ids.ok) return ids.res

  // A chave da subconta é decifrada por _shared/subaccount-key.ts (segredo próprio, ou o ASAAS_API_KEY no formato antigo).
  if (!Deno.env.get('ALBER_KEYS_ENCRYPTION_KEY') && !Deno.env.get('ASAAS_API_KEY')) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
  if (!loaded.ok) return loaded.res
  const company = loaded.company
  if (!isOperational(company)) return notApproved()

  try {
    const key = await decryptSubaccountKey(company.asaas_api_key_enc as string)
    const balance_cents = await getParentBalanceCents(key)
    return json({ balance_cents, generated_at: new Date().toISOString() })
  } catch (e) {
    await logError(supabaseAdmin, 'food-company-balance', e, { company_id: company.id })
    return err('BALANCE_PROVIDER_ERROR', 'Falha ao consultar o saldo no Asaas', 502)
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
