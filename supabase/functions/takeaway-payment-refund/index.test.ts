// Unit tests — takeaway-payment-refund e takeaway-payment-cancel
// Roda com: deno test supabase/functions/takeaway-payment-refund/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ASAAS_API_KEY', 'parent-key')
const KEY = 'k'.repeat(40)
Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)

import { handleRequest as refund } from './index.ts'
import { handleRequest as cancel } from '../takeaway-payment-cancel/index.ts'

const calls: { method: string; url: string; body: unknown }[] = []

function withMock<T>(payment: unknown, fn: () => Promise<T>, refundFails = false): Promise<T> {
  const orig = globalThis.fetch
  calls.length = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/rest/v1/')) return ok({}, 201)
    if (url.includes('/refund') && method === 'POST') return refundFails ? ok({ errors: [{ description: 'valor maior' }] }, 400) : ok({ id: 'pay_1' })
    if (url.includes('/payments/pay_abc123') && method === 'GET') return ok(payment)
    if (url.includes('/payments/pay_abc123') && method === 'DELETE') return ok({ deleted: true })
    return ok({ error: `Unmocked ${method} ${url}` }, 500)
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const REF = 'food_22222222-2222-4222-8222-222222222222'
const OTHER = 'food_99999999-9999-4999-8999-999999999999'
const PAID = { status: 'CONFIRMED', externalReference: REF, refunds: [] }
const body = { payment_id: 'pay_abc123', external_reference: REF, amount_cents: 600, idempotency_key: 'chave-12345678' }
const post = (fn: typeof refund, b: unknown, key: string | null = KEY) =>
  fn(new Request('http://localhost/x', { method: 'POST', headers: key === null ? {} : { 'x-alber-food-key': key }, body: JSON.stringify(b) }))

Deno.test('estorno: exige a chave de serviço', async () => {
  const res = await withMock(PAID, () => post(refund, body, null))
  assertEquals(res.status, 401)
  assertEquals(calls.length, 0)
})

Deno.test('estorno parcial: pede ao Asaas o valor em reais, com a chave de idempotência na descrição', async () => {
  const res = await withMock(PAID, () => post(refund, body))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).refund_id, 'chave-12345678')
  const r = calls.find((c) => c.url.includes('/refund'))!
  assertEquals(r.body, { value: 6, description: 'Estorno de pedido [ref:chave-12345678]' })
})

Deno.test('repetir o estorno com a mesma chave não devolve duas vezes', async () => {
  const already = { ...PAID, refunds: [{ description: 'Estorno de pedido [ref:chave-12345678]', value: 6 }] }
  const res = await withMock(already, () => post(refund, body))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).repeated, true)
  assertEquals(calls.some((c) => c.url.includes('/refund')), false)
})

Deno.test('estorno de pagamento de outra referência, pendente ou inválido é recusado', async () => {
  assertEquals((await withMock({ ...PAID, externalReference: OTHER }, () => post(refund, body))).status, 409)
  const pending = await withMock({ ...PAID, status: 'PENDING' }, () => post(refund, body))
  assertEquals([pending.status, (await pending.json()).error], [409, 'PAYMENT_NOT_REFUNDABLE'])
  for (const over of [{ payment_id: 'abc' }, { external_reference: 'tx_1' }, { amount_cents: 0 }, { amount_cents: 1.5 }, { idempotency_key: 'curta' }]) {
    assertEquals((await withMock(PAID, () => post(refund, { ...body, ...over }))).status, 422, JSON.stringify(over))
  }
  assertEquals(calls.some((c) => c.url.includes('/refund')), false)
})

Deno.test('o Asaas recusando o estorno vira 422 sem repassar a mensagem', async () => {
  const res = await withMock(PAID, () => post(refund, body), true)
  assertEquals(res.status, 422)
  const j = await res.json()
  assertEquals(j.error, 'REFUND_REJECTED')
  assertEquals(JSON.stringify(j).includes('valor maior'), false)
})

Deno.test('cancelar cobrança: exige chave e a referência certa, e apaga no Asaas', async () => {
  const cb = { payment_id: 'pay_abc123', external_reference: REF }
  assertEquals((await withMock(PAID, () => post(cancel, cb, null))).status, 401)
  assertEquals((await withMock({ ...PAID, externalReference: OTHER }, () => post(cancel, cb))).status, 409)
  const ok = await withMock(PAID, () => post(cancel, cb))
  assertEquals(ok.status, 200)
  assertEquals(calls.some((c) => c.method === 'DELETE' && c.url.includes('/payments/pay_abc123')), true)
  assertEquals((await withMock(PAID, () => post(cancel, { ...cb, payment_id: 'x' }))).status, 422)
})
