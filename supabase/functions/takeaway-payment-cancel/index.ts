// Cancela uma cobrança de take away que ninguém pagou (Pix vencido no Alber Food).
// POST /takeaway-payment-cancel { payment_id, external_reference } -> { cancelled: true }
//
// Só o Alber Food chama (x-alber-food-key). Cobrança já paga NÃO é cancelada aqui (o Asaas recusa; use o estorno).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { requireFoodKey, FOOD_REFERENCE, ASAAS_PAYMENT_ID } from '../_shared/food-service.ts'
import { cancelPayment, getPaymentWithRefunds } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const denied = requireFoodKey(req)
  if (denied) return denied

  let body: { payment_id?: unknown; external_reference?: unknown }
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  const paymentId = typeof body.payment_id === 'string' ? body.payment_id : ''
  const reference = typeof body.external_reference === 'string' ? body.external_reference : ''
  if (!ASAAS_PAYMENT_ID.test(paymentId)) return err('INVALID_PAYMENT', 'payment_id inválido', 422)
  if (!FOOD_REFERENCE.test(reference)) return err('INVALID_REFERENCE', 'external_reference inválida', 422)

  const parentKey = Deno.env.get('ASAAS_API_KEY')
  if (!parentKey) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const found = await getPaymentWithRefunds(paymentId, parentKey)
    if (found.externalReference !== reference) return err('PAYMENT_MISMATCH', 'Cobrança não corresponde à referência', 409)
    await cancelPayment(paymentId, parentKey)
    return json({ cancelled: true })
  } catch (e) {
    await logError(supabaseAdmin, 'takeaway-payment-cancel', e, { reference })
    return err('PAYMENT_PROVIDER_ERROR', 'Falha ao cancelar a cobrança', 502)
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
