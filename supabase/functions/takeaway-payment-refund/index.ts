// Estorno (total ou parcial) de uma cobrança de take away do Alber Food.
// POST /takeaway-payment-refund { payment_id, external_reference, amount_cents, idempotency_key } -> { refund_id }
//
// Só o Alber Food chama (x-alber-food-key). O Asaas devolve também a parte do split (proporcional). A chave de
// idempotência vai na descrição do estorno: repetir a chamada depois de um timeout NÃO devolve duas vezes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { requireFoodKey, FOOD_REFERENCE, ASAAS_PAYMENT_ID, toReais } from '../_shared/food-service.ts'
import { getPaymentWithRefunds, refundPayment, AsaasError } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

const KEY = /^[0-9a-zA-Z_-]{8,80}$/

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const denied = requireFoodKey(req)
  if (denied) return denied

  let body: { payment_id?: unknown; external_reference?: unknown; amount_cents?: unknown; idempotency_key?: unknown }
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const paymentId = typeof body.payment_id === 'string' ? body.payment_id : ''
  const reference = typeof body.external_reference === 'string' ? body.external_reference : ''
  const key = typeof body.idempotency_key === 'string' ? body.idempotency_key : ''
  if (!ASAAS_PAYMENT_ID.test(paymentId)) return err('INVALID_PAYMENT', 'payment_id inválido', 422)
  if (!FOOD_REFERENCE.test(reference)) return err('INVALID_REFERENCE', 'external_reference inválida', 422)
  if (!KEY.test(key)) return err('INVALID_KEY', 'idempotency_key inválida', 422)
  if (typeof body.amount_cents !== 'number' || !Number.isInteger(body.amount_cents) || body.amount_cents < 1 || body.amount_cents > 500_000) return err('INVALID_AMOUNT', 'amount_cents inválido', 422)

  const parentKey = Deno.env.get('ASAAS_API_KEY')
  if (!parentKey) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const marker = `[ref:${key}]`
  try {
    // A cobrança tem de ser mesmo desta referência (a chave do Asaas é da conta pai: nunca estornar pagamento alheio).
    const found = await getPaymentWithRefunds(paymentId, parentKey)
    if (found.externalReference !== reference) return err('PAYMENT_MISMATCH', 'Cobrança não corresponde à referência', 409)
    if (found.refunds.some((r) => r.description?.includes(marker))) return json({ refund_id: key, repeated: true })
    if (found.status !== 'CONFIRMED' && found.status !== 'RECEIVED' && found.status !== 'REFUND_REQUESTED' && found.status !== 'PARTIALLY_REFUNDED') {
      return err('PAYMENT_NOT_REFUNDABLE', 'Pagamento não está em situação de estorno', 409)
    }
    await refundPayment(paymentId, toReais(body.amount_cents), `Estorno de pedido ${marker}`, parentKey)
    await supabaseAdmin.from('audit_logs').insert({
      user_id: null,
      event_type: 'takeaway_payment_refunded',
      metadata: { reference, payment_id: paymentId, amount_cents: body.amount_cents },
    })
    return json({ refund_id: key })
  } catch (e) {
    await logError(supabaseAdmin, 'takeaway-payment-refund', e, { reference })
    if (e instanceof AsaasError || (e instanceof Error && e.message.startsWith('ASAAS_REFUND_FAILED'))) return err('REFUND_REJECTED', 'O Asaas recusou o estorno', 422)
    return err('PAYMENT_PROVIDER_ERROR', 'Falha ao estornar', 502)
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
