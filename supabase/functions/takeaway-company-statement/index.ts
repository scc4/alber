// Saldo e extrato da subconta (empresa) de um restaurante do Alber Food, somente leitura.
// POST /takeaway-company-statement { company_id } -> { balance_cents, movements: [...], generated_at }
//
// Só o Alber Food chama (x-alber-food-key), e só para empresa com KYC aprovado. A chave da subconta fica aqui (cifrada em
// companies): nunca sai. O extrato vai sem descrição (traz nome de cliente): só id, tipo, valor, saldo, data e se há
// cobrança ligada. Não movimenta dinheiro e não escreve nada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { requireFoodKey, UUID } from '../_shared/food-service.ts'
import { aesDecrypt } from '../_shared/crypto.ts'
import { getParentBalanceCents, listParentMovements } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const denied = requireFoodKey(req)
  if (denied) return denied

  let body: { company_id?: unknown }
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  const companyId = typeof body.company_id === 'string' ? body.company_id : ''
  if (!UUID.test(companyId)) return err('INVALID_COMPANY', 'company_id inválido', 422)

  const encSecret = Deno.env.get('ASAAS_API_KEY')
  if (!encSecret) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await supabaseAdmin.from('companies').select('id, asaas_api_key_enc, kyc_status, deleted_at').eq('id', companyId).maybeSingle()
  if (error) return err('DB_ERROR', 'Erro ao consultar a empresa', 503)
  const c = data as { id: string; asaas_api_key_enc: string | null; kyc_status: string; deleted_at: string | null } | null
  if (!c || c.deleted_at) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)
  if (c.kyc_status !== 'approved' || !c.asaas_api_key_enc) return err('COMPANY_NOT_APPROVED', 'Empresa sem conta aprovada', 409)
  try {
    const key = await aesDecrypt(c.asaas_api_key_enc, encSecret)
    const balance_cents = await getParentBalanceCents(key)
    const movements = await listParentMovements(key, 40)
    return json({ balance_cents, movements, generated_at: new Date().toISOString() })
  } catch (e) {
    await logError(supabaseAdmin, 'takeaway-company-statement', e, { company_id: companyId })
    return err('STATEMENT_PROVIDER_ERROR', 'Falha ao consultar o Asaas', 502)
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
