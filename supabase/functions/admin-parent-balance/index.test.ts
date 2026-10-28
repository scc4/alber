// Unit tests — admin-parent-balance (saldo e extrato da conta pai, somente leitura, para o Alber Admin)
// Roda com: deno test supabase/functions/admin-parent-balance/index.test.ts --allow-env --allow-net

import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

const KEY = 'k'.repeat(40)
Deno.env.set('ALBER_ADMIN_SERVICE_KEY', KEY)
Deno.env.set('ASAAS_API_KEY', 'parent-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('SUPABASE_URL', 'https://supabase.test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')

import { handleRequest } from './index.ts'

const ACTOR = '11111111-1111-4111-8111-111111111111'
const req = (body: unknown = { actor_id: ACTOR, actor_email: 'fernando@usealber.com' }, key: string | null = KEY, method = 'POST') =>
  new Request('http://localhost/admin-parent-balance', { method, headers: key === null ? {} : { 'x-alber-admin-key': key }, body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })

interface Sent { url: string; method: string }
function run(r: Request, asaas: (url: string) => Response): Promise<{ res: Response; asaasCalls: Sent[]; inserts: { table: string; body: unknown }[] }> {
  const orig = globalThis.fetch
  const asaasCalls: Sent[] = []
  const inserts: { table: string; body: unknown }[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('https://supabase.test')) {
      inserts.push({ table: url.split('/rest/v1/')[1] ?? url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return new Response('[]', { status: 201 })
    }
    asaasCalls.push({ url, method: (init?.method ?? 'GET').toUpperCase() })
    return asaas(url)
  }) as typeof fetch
  return handleRequest(r).then((res) => ({ res, asaasCalls, inserts })).finally(() => { globalThis.fetch = orig })
}

const ok = (url: string): Response => {
  if (url.includes('/finance/balance')) return new Response(JSON.stringify({ balance: 1234.56 }), { status: 200 })
  if (url.includes('/finance/payment/statistics')) return new Response(JSON.stringify({ quantity: 3, value: 200, netValue: 195.5 }), { status: 200 })
  if (url.includes('/financialTransactions'))
    return new Response(JSON.stringify({ data: [
      { id: 'ft_1', type: 'PAYMENT_RECEIVED', value: 50, balance: 1234.56, date: '2026-10-26', description: 'Cobrança recebida de Maria da Silva CPF 123.456.789-09', paymentId: 'pay_1' },
      { id: 'ft_2', type: 'TRANSFER', value: -20.1, balance: 1184.56, date: '2026-10-25', description: 'Transferência para João' },
    ] }), { status: 200 })
  return new Response('{}', { status: 404 })
}

Deno.test('só POST; sem chave, chave errada ou a chave do Alber Food: nada é consultado no Asaas', async () => {
  assertEquals((await run(req({}, KEY, 'GET'), ok)).res.status, 405)
  for (const k of [null, 'errado', KEY.slice(0, -1), KEY + 'x']) {
    const r = await run(req(undefined, k), ok)
    assertEquals(r.res.status, 401)
    assertEquals(r.asaasCalls.length, 0)
  }
  Deno.env.set('ALBER_FOOD_SERVICE_KEY', 'f'.repeat(40))
  assertEquals((await run(req(undefined, 'f'.repeat(40)), ok)).res.status, 401)
})

Deno.test('sem a chave de serviço configurada (ou curta), recusa tudo com 503', async () => {
  Deno.env.delete('ALBER_ADMIN_SERVICE_KEY')
  try {
    assertEquals((await run(req(), ok)).res.status, 503)
    Deno.env.set('ALBER_ADMIN_SERVICE_KEY', 'curta')
    assertEquals((await run(req(), ok)).res.status, 503)
  } finally {
    Deno.env.set('ALBER_ADMIN_SERVICE_KEY', KEY)
  }
})

Deno.test('actor_id é obrigatório e precisa ser UUID', async () => {
  for (const body of [{}, { actor_id: 'x' }, { actor_id: 12 }, 'não é json']) {
    const r = await run(req(body), ok)
    assert(r.res.status === 422 || r.res.status === 400)
    assertEquals(r.asaasCalls.length, 0)
  }
})

Deno.test('devolve saldo, a receber e extrato em centavos; só GET no Asaas e sem descrição no extrato', async () => {
  const r = await run(req(), ok)
  assertEquals(r.res.status, 200)
  const body = await r.res.json()
  assertEquals(body.balance_cents, 123456)
  assertEquals(body.to_receive, { quantity: 3, value_cents: 20000, net_cents: 19550 })
  assertEquals(body.movements.length, 2)
  assertEquals(body.movements[0], { id: 'ft_1', type: 'PAYMENT_RECEIVED', value_cents: 5000, balance_cents: 123456, date: '2026-10-26', linked: true })
  assertEquals(body.movements[1].value_cents, -2010)
  assertEquals(body.movements[1].linked, false)
  const text = JSON.stringify(body)
  for (const leak of ['Maria', 'CPF', 'João', 'description', 'pay_1']) assert(!text.includes(leak), leak)
  assert(r.asaasCalls.every((c) => c.method === 'GET'))
})

Deno.test('cada consulta registra quem pediu no audit_logs do Alber', async () => {
  const r = await run(req(), ok)
  const log = r.inserts.find((i) => i.table.startsWith('audit_logs'))
  assert(log)
  const row = log.body as { event_type: string; metadata: Record<string, string> }
  assertEquals(row.event_type, 'admin_parent_balance_viewed')
  assertEquals(row.metadata.actor_id, ACTOR)
})

Deno.test('"a receber" é opcional: se o Asaas recusar, o saldo segue com to_receive nulo', async () => {
  const r = await run(req(), (url) => (url.includes('/payment/statistics') ? new Response('{}', { status: 400 }) : ok(url)))
  assertEquals(r.res.status, 200)
  assertEquals((await r.res.json()).to_receive, null)
})

Deno.test('falha no saldo ou no extrato: 502 genérico, sem detalhe do Asaas, e nada é registrado como consultado', async () => {
  for (const bad of ['/finance/balance', '/financialTransactions']) {
    const r = await run(req(), (url) => (url.includes(bad) ? new Response(JSON.stringify({ errors: [{ description: 'segredo interno' }] }), { status: 500 }) : ok(url)))
    assertEquals(r.res.status, 502)
    const text = await r.res.text()
    assert(!text.includes('segredo interno'))
    assert(!r.inserts.some((i) => i.table.startsWith('audit_logs')))
  }
})
