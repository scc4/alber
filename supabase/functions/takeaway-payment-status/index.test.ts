// Unit tests — takeaway-payment-status
// Roda com: deno test supabase/functions/takeaway-payment-status/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ASAAS_API_KEY', 'parent-key')
const KEY = 'k'.repeat(40)
Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)

import { handleRequest } from './index.ts'

const calls: { method: string; url: string }[] = []
function withMock<T>(payment: unknown, fn: () => Promise<T>, status = 200): Promise<T> {
  const orig = globalThis.fetch
  calls.length = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url })
    const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/rest/v1/')) return ok({}, 201)
    if (url.includes('/payments/pay_0_abc123') && method === 'GET') return ok(payment, status)
    return ok({ error: `Unmocked ${method} ${url}` }, 500)
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const REF = 'food_22222222-2222-4222-8222-222222222222'
const body = { payment_id: 'pay_0_abc123', external_reference: REF }
const post = (b: unknown, key: string | null = KEY) =>
  handleRequest(new Request('http://localhost/x', { method: 'POST', headers: key === null ? {} : { 'x-alber-food-key': key }, body: JSON.stringify(b) }))

Deno.test('situação: exige a chave de serviço', async () => {
  const res = await withMock({}, () => post(body, null))
  assertEquals(res.status, 401)
  assertEquals(calls.length, 0)
})

Deno.test('cartão confirmado (id do sandbox com _): devolve o evento no formato do webhook repassado', async () => {
  const res = await withMock({ id: 'pay_0_abc123', status: 'CONFIRMED', externalReference: REF, value: 34.9, netValue: 33.15, billingType: 'CREDIT_CARD', estimatedCreditDate: '2026-12-14' }, () => post(body))
  assertEquals(res.status, 200)
  const j = await res.json()
  assertEquals(j.paid, true)
  assertEquals(j.event, {
    id: 'poll:PAYMENT_CONFIRMED:pay_0_abc123', event: 'PAYMENT_CONFIRMED', payment_id: 'pay_0_abc123', external_reference: REF,
    amount_cents: 3490, gateway_cost_cents: 175, billing_type: 'CREDIT_CARD', estimated_credit_date: '2026-12-14', credit_date: null,
  })
  // Só leitura: nunca altera a cobrança.
  assertEquals(calls.filter((c) => c.url.includes('/payments/')).map((c) => c.method), ['GET'])
})

Deno.test('Pix recebido vira PAYMENT_RECEIVED; pendente, vencida ou estornada não geram evento', async () => {
  const rec = await (await withMock({ status: 'RECEIVED', externalReference: REF, value: 10, netValue: 9.99, billingType: 'PIX' }, () => post(body))).json()
  assertEquals([rec.paid, rec.event.event], [true, 'PAYMENT_RECEIVED'])
  for (const status of ['PENDING', 'OVERDUE', 'REFUNDED']) {
    const j = await (await withMock({ status, externalReference: REF, value: 10 }, () => post(body))).json()
    assertEquals([j.status, j.paid, j.event], [status, false, null])
  }
})

Deno.test('outra referência, entrada inválida ou falha do Asaas', async () => {
  assertEquals((await withMock({ status: 'CONFIRMED', externalReference: 'food_99999999-9999-4999-8999-999999999999' }, () => post(body))).status, 409)
  for (const over of [{ payment_id: 'abc' }, { external_reference: 'tx_1' }]) {
    assertEquals((await withMock({}, () => post({ ...body, ...over }))).status, 422, JSON.stringify(over))
  }
  assertEquals((await withMock({ errors: [] }, () => post(body), 404)).status, 502)
})
