// Unit tests — takeaway-payment-create
// Roda com: deno test supabase/functions/takeaway-payment-create/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ASAAS_API_KEY', 'parent-key')
const KEY = 'k'.repeat(40)
Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)

import { handleRequest } from './index.ts'

type Call = { method: string; url: string; body: unknown }
const calls: Call[] = []

interface Mock {
  company?: unknown
  existing?: unknown
  asaasFail?: string
}

function withMock<T>(m: Mock, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  calls.length = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/rest/v1/companies')) return ok(m.company ?? null)
    if (url.includes('/rest/v1/')) return ok({}, 201)
    if (url.includes('asaas.com') && m.asaasFail && method === 'POST' && url.endsWith('/payments')) return ok({ errors: [{ description: m.asaasFail }] }, 400)
    if (url.includes('/payments?externalReference=')) return ok({ data: m.existing ? [m.existing] : [] })
    if (url.endsWith('/customers') && method === 'POST') return ok({ id: 'cus_1' })
    if (url.endsWith('/payments') && method === 'POST') return ok({ id: 'pay_abc123', invoiceUrl: 'https://sandbox.asaas.com/i/abc' })
    if (url.includes('/pixQrCode')) return ok({ payload: '00020126pixcopiaecola', encodedImage: 'x', expirationDate: '2026-10-26 23:59:59' })
    return ok({ error: `Unmocked ${method} ${url}` }, 500)
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const COMPANY = '11111111-1111-4111-8111-111111111111'
const REF = 'food_22222222-2222-4222-8222-222222222222'
const APPROVED = { id: COMPANY, asaas_wallet_id: 'wallet-1', kyc_status: 'approved', account_status: 'active', deleted_at: null }
const good = {
  company_id: COMPANY, external_reference: REF, amount_cents: 8600, fee_total_cents: 602, method: 'pix',
  customer: { name: 'Maria Souza', phone: '(11) 91234-5678' }, description: 'Pedido #1', expires_at: '2026-10-26T15:00:00.000Z',
}
const req = (body: unknown, key: string | null = KEY) =>
  new Request('http://localhost/takeaway-payment-create', { method: 'POST', headers: key === null ? {} : { 'x-alber-food-key': key }, body: JSON.stringify(body) })
const run = async (body: unknown, m: Mock = { company: APPROVED }, key: string | null = KEY) => {
  const res = await withMock(m, () => handleRequest(req(body, key)))
  return { status: res.status, json: await res.json() }
}

Deno.test('sem a chave de serviço, ou com chave errada: 401; nada é consultado', async () => {
  for (const key of [null, 'errada', KEY.slice(0, -1)]) {
    const r = await run(good, { company: APPROVED }, key)
    assertEquals(r.status, 401)
    assertEquals(calls.length, 0)
  }
})

Deno.test('GET retorna 405 e sem segredo configurado a função recusa (503)', async () => {
  assertEquals((await handleRequest(new Request('http://localhost/x', { method: 'GET' }))).status, 405)
  Deno.env.delete('ALBER_FOOD_SERVICE_KEY')
  try {
    assertEquals((await run(good)).status, 503)
  } finally {
    Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)
  }
})

Deno.test('Pix: cria a cobrança na conta pai com split para a carteira da empresa e devolve só o copia e cola', async () => {
  const r = await run(good)
  assertEquals(r.status, 201)
  assertEquals(r.json, { payment_id: 'pay_abc123', pix_payload: '00020126pixcopiaecola', expires_at: '2026-10-26T15:00:00.000Z' })
  const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/payments'))!
  const b = create.body as Record<string, unknown>
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate)), true)
  assertEquals({ ...b, dueDate: 'x' }, {
    customer: 'cus_1', billingType: 'PIX', value: 86, dueDate: 'x',
    description: 'Pedido #1', externalReference: REF, split: [{ walletId: 'wallet-1', fixedValue: 79.98 }],
  })
  assertEquals(JSON.stringify(r.json).includes('wallet'), false)
})

Deno.test('cartão: devolve a página hospedada do Asaas, sem QR', async () => {
  const r = await run({ ...good, method: 'credit_card' })
  assertEquals(r.status, 201)
  assertEquals(r.json.invoice_url, 'https://sandbox.asaas.com/i/abc')
  assertEquals(r.json.pix_payload, undefined)
  assertEquals(calls.some((c) => c.url.includes('/pixQrCode')), false)
})

Deno.test('repetir a chamada (timeout) devolve a cobrança que já existe, sem criar outra', async () => {
  const r = await run(good, { company: APPROVED, existing: { id: 'pay_old999', status: 'PENDING' } })
  assertEquals(r.status, 201)
  assertEquals(r.json.payment_id, 'pay_old999')
  assertEquals(calls.some((c) => c.method === 'POST' && c.url.endsWith('/payments')), false)
  assertEquals(calls.some((c) => c.url.endsWith('/customers')), false)
})

Deno.test('empresa inexistente, apagada ou sem KYC aprovado/carteira/ativa não recebe cobrança', async () => {
  assertEquals((await run(good, { company: null })).json.error, 'COMPANY_NOT_FOUND')
  assertEquals((await run(good, { company: { ...APPROVED, deleted_at: '2026-01-01' } })).json.error, 'COMPANY_NOT_FOUND')
  for (const over of [{ kyc_status: 'pending' }, { kyc_status: 'submitted' }, { account_status: 'blocked' }, { asaas_wallet_id: null }]) {
    const r = await run(good, { company: { ...APPROVED, ...over } })
    assertEquals([r.status, r.json.error], [409, 'COMPANY_NOT_APPROVED'])
    assertEquals(calls.some((c) => c.url.includes('asaas.com') && c.method === 'POST'), false)
  }
})

Deno.test('valida o corpo: empresa, referência, método, valores, taxa, cliente e prazo', async () => {
  const bad: [string, Record<string, unknown>][] = [
    ['INVALID_COMPANY', { company_id: 'x' }],
    ['INVALID_REFERENCE', { external_reference: 'tx_123' }],
    ['INVALID_REFERENCE', { external_reference: 'food_não-uuid' }],
    ['INVALID_METHOD', { method: 'boleto' }],
    ['INVALID_AMOUNT', { amount_cents: 499 }],
    ['INVALID_AMOUNT', { amount_cents: 500_001 }],
    ['INVALID_AMOUNT', { amount_cents: 10.5 }],
    ['INVALID_AMOUNT', { amount_cents: '8600' }],
    ['INVALID_FEE', { fee_total_cents: -1 }],
    ['INVALID_FEE', { fee_total_cents: 8600 }], // sobraria zero para o restaurante
    ['INVALID_CUSTOMER', { customer: { name: 'A' } }],
    ['INVALID_CUSTOMER', { customer: { name: 'Ana', phone: '123' } }],
    ['INVALID_EXPIRY', { expires_at: 'ontem' }],
  ]
  for (const [error, over] of bad) {
    const r = await run({ ...good, ...over })
    assertEquals([r.status, r.json.error], [422, error], JSON.stringify(over))
  }
  const broken = await withMock({}, () => handleRequest(new Request('http://localhost/x', { method: 'POST', headers: { 'x-alber-food-key': KEY }, body: '{ruim' })))
  assertEquals(broken.status, 400)
})

Deno.test('o Asaas recusando vira 502 sem repassar a mensagem do provedor', async () => {
  const r = await run(good, { company: APPROVED, asaasFail: 'cpfCnpj obrigatório' })
  assertEquals([r.status, r.json.error], [502, 'PAYMENT_PROVIDER_ERROR'])
  assertEquals(JSON.stringify(r.json).includes('cpfCnpj'), false)
})
