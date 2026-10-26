// Webhook da CONTA PAI do Asaas para os pedidos do Alber Food (cobranças criadas por takeaway-payment-create).
// POST com o cabeçalho asaas-access-token = FOOD_ASAAS_WEBHOOK_TOKEN (token próprio, separado do ASAAS_WEBHOOK_SECRET
// das subcontas: se um vazar, o outro não é afetado).
//
// Só repassa eventos de cobrança cuja referência começa com 'food_' (assinados, ver _shared/food-webhook.ts). Qualquer
// outro evento recebe 200 e é descartado: esta função nunca toca em tabelas do app Alber.
// Configurar no painel do Asaas (conta pai): Integrações > Webhooks > categoria "Cobranças", API v3, envio sequencial.

import { forwardToFood, isFoodReference, type AsaasPaymentEvent } from '../_shared/food-webhook.ts'

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  // Sem o token configurado a função recusa tudo (nunca fica aberta por esquecimento).
  const expected = Deno.env.get('FOOD_ASAAS_WEBHOOK_TOKEN')
  if (!expected || expected.length < 32) return new Response('Service Unavailable', { status: 503 })
  const received = req.headers.get('asaas-access-token') ?? ''
  if (!received || !safeEqual(received, expected)) return new Response('Unauthorized', { status: 401 })

  let payload: AsaasPaymentEvent
  try {
    payload = (await req.json()) as AsaasPaymentEvent
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  if (typeof payload?.event !== 'string' || !payload.event.startsWith('PAYMENT_')) return new Response('OK', { status: 200 })
  if (!payload.payment || typeof payload.payment.id !== 'string' || !isFoodReference(payload.payment.externalReference)) return new Response('OK', { status: 200 })

  return await forwardToFood(payload)
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
