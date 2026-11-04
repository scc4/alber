// POST /food-company-withdraw-status   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário; verify_jwt padrão, como as takeaway-*)
//   { company_id, owner_ref, transaction_ids: string[] (1 a 20 UUIDs) }
//   -> 200 { items: [{ transaction_id, status: 'processing'|'completed'|'failed', amount_cents, destination_masked, created_at,
//                      completed_at|null, failure_code|null }] }
//
// Acompanha os saques feitos por food-company-withdraw. Somente leitura, sem autorização assinada. Devolve só lançamentos de SAQUE desta
// empresa (type 'descarregar' com via 'food'): ids de outra empresa, de outro tipo ou inexistentes simplesmente não aparecem (nunca 403 que revele
// existência). Empresa de outro dono: 404 COMPANY_NOT_FOUND. O status vem do que o webhook TRANSFER_DONE/TRANSFER_FAILED do Asaas grava na
// transação ('pending' e 'processing' = processing; 'completed'; 'failed'). `failure_code` é genérico (TRANSFER_FAILED), nunca texto do Asaas.
// `completed_at` é a data da conclusão, lida do audit_logs que o webhook grava (descarregar_completed / descarregar_failed; transactions não tem
// updated_at); null enquanto não conclui.

import { handleCors, json, err } from '../_shared/cors.ts'
import { UUID } from '../_shared/food-service.ts'
import { adminClient, isObject, loadOwnedCompany, readIds, readServiceBody } from '../_shared/food-company.ts'

export const MAX_STATUS_IDS = 20

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const ids = readIds(parsed.body)
  if (!ids.ok) return ids.res
  const list = parsed.body.transaction_ids
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_STATUS_IDS || !list.every((v) => typeof v === 'string' && UUID.test(v))) {
    return err('INVALID_TRANSACTION_IDS', `transaction_ids deve ter de 1 a ${MAX_STATUS_IDS} UUIDs`, 422)
  }
  const wanted = [...new Set((list as string[]).map((v) => v.toLowerCase()))]

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
  if (!loaded.ok) return loaded.res.status === 403 ? err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404) : loaded.res

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('id, status, amount, created_at, metadata')
    .eq('company_id', loaded.company.id)
    .eq('type', 'descarregar')
    .in('id', wanted)
  if (error) return err('DB_ERROR', 'Erro ao consultar os saques', 503)

  const rows = (Array.isArray(data) ? data : []).filter((t) => isObject(t.metadata) && (t.metadata as Record<string, unknown>).via === 'food')
  const doneAt = new Map<string, string>()
  if (rows.some((t) => t.status === 'completed' || t.status === 'failed')) {
    const { data: audits } = await supabaseAdmin
      .from('audit_logs')
      .select('created_at, metadata')
      .in('event_type', ['descarregar_completed', 'descarregar_failed'])
      .in('metadata->>transaction_id', rows.map((t) => t.id as string))
    for (const a of Array.isArray(audits) ? audits : []) {
      const id = (a.metadata as Record<string, unknown> | null)?.transaction_id
      if (typeof id === 'string') doneAt.set(id, a.created_at as string)
    }
  }

  const items = rows
    .map((t) => {
      const status = t.status === 'completed' ? 'completed' : t.status === 'failed' ? 'failed' : 'processing'
      const meta = t.metadata as Record<string, unknown>
      return {
        transaction_id: t.id as string,
        status,
        amount_cents: Math.round(Number(t.amount) * 100),
        destination_masked: typeof meta.destination_masked === 'string' ? meta.destination_masked : null,
        created_at: t.created_at as string,
        completed_at: status === 'processing' ? null : (doneAt.get(t.id as string) ?? null),
        failure_code: status === 'failed' ? 'TRANSFER_FAILED' : null,
      }
    })
    .sort((a, b) => wanted.indexOf(a.transaction_id.toLowerCase()) - wanted.indexOf(b.transaction_id.toLowerCase()))

  return json({ items })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
