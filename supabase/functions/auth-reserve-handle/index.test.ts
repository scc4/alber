// Unit tests — auth-reserve-handle Edge Function
// Roda com: deno test supabase/functions/auth-reserve-handle/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
const KEY = 'k'.repeat(40)
Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)

import { handleRequest } from './index.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }
const calls: { method: string; url: string }[] = []

function withMock<T>(routes: MockRoute[], fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  calls.length = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url })
    for (const r of routes) {
      if ((!r.method || r.method.toUpperCase() === method) && url.includes(r.pattern)) {
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const OWNER = '11111111-1111-4111-8111-111111111111'
const req = (body: unknown, key: string | null = KEY) =>
  new Request('http://localhost/auth-reserve-handle', {
    method: 'POST',
    headers: { ...(key === null ? {} : { 'x-alber-food-key': key }) },
    body: JSON.stringify(body),
  })

const FREE: MockRoute[] = [
  { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [] },
  { pattern: '/rest/v1/handle_reservations', method: 'DELETE', status: 200, body: [] },
  { pattern: '/rest/v1/handle_reservations', method: 'POST', status: 201, body: [] },
]

Deno.test('sem a chave de serviço, ou com chave errada → 401; sem o segredo configurado → 503', async () => {
  for (const key of [null, '', 'errada', KEY + 'x']) {
    assertEquals((await withMock([], () => handleRequest(req({ action: 'reserve', handle: 'loja', owner_ref: OWNER }, key)))).status, 401, String(key))
  }
  Deno.env.delete('ALBER_FOOD_SERVICE_KEY')
  try {
    assertEquals((await withMock([], () => handleRequest(req({ action: 'reserve', handle: 'loja', owner_ref: OWNER })))).status, 503)
  } finally {
    Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)
  }
})

Deno.test('GET → 405; JSON inválido → 400; dono inválido → 422; ação inválida → 422', async () => {
  assertEquals((await withMock([], () => handleRequest(new Request('http://localhost/x', { method: 'GET' })))).status, 405)
  const bad = new Request('http://localhost/x', { method: 'POST', headers: { 'x-alber-food-key': KEY }, body: '{' })
  assertEquals((await withMock([], () => handleRequest(bad))).status, 400)
  assertEquals((await withMock([], () => handleRequest(req({ action: 'reserve', handle: 'loja', owner_ref: 'x' })))).status, 422)
  assertEquals((await withMock([], () => handleRequest(req({ action: 'apagar-tudo', owner_ref: OWNER })))).status, 422)
})

Deno.test('@ com formato inválido (ou que começa por número) → 422 sem tocar no banco', async () => {
  for (const handle of ['ab', '1loja', '_loja', 'loja_', 'a__b', 'tem espaco', 'x'.repeat(21), '']) {
    const res = await withMock([], () => handleRequest(req({ action: 'reserve', handle, owner_ref: OWNER })))
    assertEquals(res.status, 422, handle)
    assertEquals(calls.length, 0)
  }
})

Deno.test('@ livre → reservado (aceita @ e maiúsculas) e a reserva anterior do dono é solta', async () => {
  const res = await withMock([...FREE, { pattern: '/rest/v1/handle_reservations', method: 'GET', status: 200, body: { owner_ref: OWNER } }], () =>
    handleRequest(req({ action: 'reserve', handle: '@Loja_Da_Ana', owner_ref: OWNER })))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).reserved, true)
  assertEquals(calls.some((c) => c.method === 'DELETE' && c.url.includes('owner_ref=eq.' + OWNER)), true)
  assertEquals(calls.some((c) => c.method === 'POST' && c.url.includes('handle_reservations')), true)
})

Deno.test('@ de usuário (com ou sem @ gravado) ou de empresa ativa → 409, sem reservar', async () => {
  const user = await withMock([{ pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1' }] }, { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [] }], () =>
    handleRequest(req({ action: 'reserve', handle: 'fernando', owner_ref: OWNER })))
  assertEquals(user.status, 409)
  assertEquals(calls.some((c) => c.url.includes('users') && c.url.includes('%40fernando')), true) // consulta também a forma "@fernando"
  const company = await withMock([{ pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] }, { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [{ id: 'c1' }] }], () =>
    handleRequest(req({ action: 'reserve', handle: 'chocolateria', owner_ref: OWNER })))
  assertEquals(company.status, 409)
  assertEquals(calls.some((c) => c.method === 'POST' && c.url.includes('handle_reservations')), false)
})

Deno.test('@ já reservado por outro dono → 409 (a leitura depois do insert mostra o outro)', async () => {
  const res = await withMock([...FREE, { pattern: '/rest/v1/handle_reservations', method: 'GET', status: 200, body: { owner_ref: '22222222-2222-4222-8222-222222222222' } }], () =>
    handleRequest(req({ action: 'reserve', handle: 'disputado', owner_ref: OWNER })))
  assertEquals(res.status, 409)
})

Deno.test('liberar apaga as reservas do dono', async () => {
  const res = await withMock([{ pattern: '/rest/v1/handle_reservations', method: 'DELETE', status: 200, body: [] }], () => handleRequest(req({ action: 'release', owner_ref: OWNER })))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).released, true)
  assertEquals(calls.some((c) => c.method === 'DELETE' && c.url.includes('owner_ref=eq.' + OWNER)), true)
})
