// Unit tests — repasse de eventos de pedidos do Alber Food
// Roda com: deno test supabase/functions/_shared/food-webhook.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { forwardToFood, foodEventBody, isFoodReference, signFoodEvent } from './food-webhook.ts'

const SECRET = 's'.repeat(40)
const REF = 'food_22222222-2222-4222-8222-222222222222'
const evt = { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', value: 86, netValue: 82.51, externalReference: REF } }

Deno.test('só referências food_ são do Alber Food', () => {
  assertEquals(isFoodReference(REF), true)
  for (const r of [undefined, '', 'uuid-da-transacao', 'FOOD_x', ' food_x']) assertEquals(isFoodReference(r), false)
})

Deno.test('o corpo vai em centavos inteiros, com o custo real do Asaas', () => {
  assertEquals(JSON.parse(foodEventBody(evt)), { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment_id: 'pay_1', external_reference: REF, amount_cents: 8600, gateway_cost_cents: 349 })
  // Sem id no evento, o id é derivado (estável: a reentrega cai na mesma chave).
  assertEquals(JSON.parse(foodEventBody({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 5, externalReference: REF } })).id, 'PAYMENT_RECEIVED:pay_1')
  assertEquals(JSON.parse(foodEventBody({ event: 'X', payment: { id: 'p', externalReference: REF } })).amount_cents, null)
})

Deno.test('a assinatura é HMAC-SHA256 de "timestamp.corpo" em hexadecimal', async () => {
  const sig = await signFoodEvent(SECRET, '1790000000', '{"a":1}')
  assertEquals(/^[0-9a-f]{64}$/.test(sig), true)
  assertEquals(sig, await signFoodEvent(SECRET, '1790000000', '{"a":1}'))
  assertEquals(sig === (await signFoodEvent(SECRET, '1790000001', '{"a":1}')), false)
  assertEquals(sig === (await signFoodEvent('outro-segredo-qualquer-com-40-caracteres', '1790000000', '{"a":1}')), false)
})

function withFetch<T>(status: number | 'throw', fn: () => Promise<T>): Promise<{ result: T; sent: Request | null }> {
  const orig = globalThis.fetch
  let sent: Request | null = null
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent = new Request(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init)
    if (status === 'throw') throw new Error('rede')
    return new Response('{}', { status })
  }) as typeof fetch
  return fn().then((result) => ({ result, sent })).finally(() => { globalThis.fetch = orig })
}

Deno.test('repassa assinado; 2xx e 4xx do Alber Food viram 200 para o Asaas, 5xx e falha de rede viram 502', async () => {
  Deno.env.set('FOOD_WEBHOOK_URL', 'https://food.test/api/internal/asaas-event')
  Deno.env.set('FOOD_WEBHOOK_SECRET', SECRET)
  const ok = await withFetch(200, () => forwardToFood(evt))
  assertEquals(ok.result.status, 200)
  const h = ok.sent!.headers
  const raw = await ok.sent!.text()
  assertEquals(h.get('x-alber-signature'), await signFoodEvent(SECRET, h.get('x-alber-timestamp')!, raw))
  assertEquals((await withFetch(401, () => forwardToFood(evt))).result.status, 200) // repetir não adianta: não trava a fila
  assertEquals((await withFetch(503, () => forwardToFood(evt))).result.status, 502)
  assertEquals((await withFetch('throw', () => forwardToFood(evt))).result.status, 502)
})

Deno.test('sem a configuração do repasse, responde 503 e não chama ninguém', async () => {
  Deno.env.delete('FOOD_WEBHOOK_URL')
  const r = await withFetch(200, () => forwardToFood(evt))
  assertEquals(r.result.status, 503)
  assertEquals(r.sent, null)
})
