// Situação de uma cobrança de take away, para o Alber Food conferir um pedido que continua pendente.
// POST /takeaway-payment-status { payment_id, external_reference } -> { status, paid, event }
//
// Reserva do webhook (webhooks-asaas-food): se o aviso do Asaas não chegar, o Food pergunta. `event` vem no MESMO formato do
// evento assinado que o Food já recebe (food-webhook.ts), para ele aplicar pelo mesmo caminho; null enquanto não está pago.
// Só o Alber Food chama (x-alber-food-key). Só leitura: nunca altera a cobrança.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0'
import { handleCors, json, err } from '../_shared/cors.ts'
import { requireFoodKey, FOOD_REFERENCE, ASAAS_PAYMENT_ID, UUID } from '../_shared/food-service.ts'
import { getPayment } from '../_shared/asaas.ts'
import { foodEventBody } from '../_shared/food-webhook.ts'
import { keyForPayment } from '../_shared/food-subaccount.ts'
import { logError } from '../_shared/error-log.ts'

/** Situação do Asaas -> evento equivalente. Estornada, vencida ou pendente não gera evento. */
const PAID: Record<string, 'PAYMENT_CONFIRMED' | 'PAYMENT_RECEIVED'> = {
  CONFIRMED: 'PAYMENT_CONFIRMED',
  RECEIVED: 'PAYMENT_RECEIVED',
  RECEIVED_IN_CASH: 'PAYMENT_RECEIVED',
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const denied = requireFoodKey(req)
  if (denied) return denied

  let body: { payment_id?: unknown; company_id?: unknown; external_reference?: unknown }
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  const paymentId = typeof body.payment_id === 'string' ? body.payment_id : ''
  const reference = typeof body.external_reference === 'string' ? body.external_reference : ''
  if (!ASAAS_PAYMENT_ID.test(paymentId)) return err('INVALID_PAYMENT', 'payment_id inválido', 422)
  if (!FOOD_REFERENCE.test(reference)) return err('INVALID_REFERENCE', 'external_reference inválida', 422)

  // company_id (opcional): a cobrança nova vive na subconta da empresa, então a chave dela é quem consulta/estorna/cancela. Sem ele, a chave pai (cobranças antigas).
  const companyId = typeof body.company_id === 'string' ? body.company_id : null
  if (companyId !== null && !UUID.test(companyId)) return err('INVALID_COMPANY', 'company_id inválido', 422)

  const parentKey = Deno.env.get('ASAAS_API_KEY')
  if (!parentKey) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const keyed = await keyForPayment(supabaseAdmin, companyId, parentKey, reference)
  if ('error' in keyed) return err(keyed.error, 'Empresa não encontrada', keyed.error === 'DB_ERROR' ? 503 : 404)
  try {
    const p = await getPayment(paymentId, keyed.key)
    if (p.externalReference !== reference) return err('PAYMENT_MISMATCH', 'Cobrança não corresponde à referência', 409)
    const kind = PAID[p.status]
    // id próprio por situação: a consulta repetida não duplica, e o webhook que chegar depois (id do Asaas) cai no "já confirmado".
    const event = kind ? JSON.parse(foodEventBody({ id: `poll:${kind}:${paymentId}`, event: kind, payment: { ...p, id: paymentId, externalReference: reference } })) : null
    return json({ status: p.status, paid: !!kind, event })
  } catch (e) {
    await logError(supabaseAdmin, 'takeaway-payment-status', e, { reference })
    return err('PAYMENT_PROVIDER_ERROR', 'Falha ao consultar a cobrança', 502)
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
