// Unit tests — auth-check-email Edge Function
// Roda com: deno test supabase/functions/auth-check-email/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

const KEY = 'k'.repeat(40)
Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)

import { handleRequest } from './index.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }

function withMock<T>(routes: MockRoute[], fn: () => Promise<T>, seen?: string[]): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    seen?.push(decodeURIComponent(url))
    for (const r of routes) {
      if ((!r.method || r.method.toUpperCase() === method) && url.includes(r.pattern)) {
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const req = (email: unknown, key: string | null = KEY) =>
  new Request('http://localhost/auth-check-email', {
    method: 'POST',
    headers: key ? { 'x-alber-food-key': key } : {},
    body: JSON.stringify({ email }),
  })

const RATE_OK: MockRoute = { pattern: '/rest/v1/audit_logs', method: 'GET', status: 200, body: [] }
const AUDIT: MockRoute = { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} }
const USERS = (rows: unknown[]): MockRoute => ({ pattern: '/rest/v1/users', method: 'GET', status: 200, body: rows })

Deno.test('GET retorna 405', async () => {
  const res = await handleRequest(new Request('http://localhost/auth-check-email', { method: 'GET' }))
  assertEquals(res.status, 405)
})

Deno.test('sem a chave de serviço → 401; chave errada → 401', async () => {
  assertEquals((await handleRequest(req('a@x.com', null))).status, 401)
  assertEquals((await handleRequest(req('a@x.com', 'x'.repeat(40)))).status, 401)
})

Deno.test('segredo não configurado → 503 (nunca fica aberta)', async () => {
  Deno.env.set('ALBER_FOOD_SERVICE_KEY', 'curto')
  try {
    assertEquals((await handleRequest(req('a@x.com'))).status, 503)
  } finally {
    Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)
  }
})

Deno.test('e-mail inválido → 422 (sem tocar no banco)', async () => {
  for (const bad of ['', 'sem-arroba', 'a@b', null, 42]) {
    const res = await withMock([], () => handleRequest(req(bad)))
    assertEquals(res.status, 422, String(bad))
  }
})

Deno.test('rate limit (30 consultas em 15min) → 429', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': '0-0/30' } })
    }
    return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    assertEquals((await handleRequest(req('a@x.com'))).status, 429)
  } finally {
    globalThis.fetch = orig
  }
})

Deno.test('e-mail de usuário existente → { exists: true }; livre → { exists: false }', async () => {
  const taken = await withMock([RATE_OK, AUDIT, USERS([{ id: 'u1' }])], () => handleRequest(req('Ana@Exemplo.com ')))
  assertEquals((await taken.json()).exists, true)
  const free = await withMock([RATE_OK, AUDIT, USERS([])], () => handleRequest(req('livre@exemplo.com')))
  assertEquals((await free.json()).exists, false)
})

Deno.test('compara sem diferenciar maiúsculas e escapa curingas (% e _)', async () => {
  const seen: string[] = []
  await withMock([RATE_OK, AUDIT, USERS([])], () => handleRequest(req('Ana_Souza@Exemplo.com')), seen)
  const q = seen.find((u) => u.includes('/rest/v1/users')) ?? ''
  assertEquals(q.includes('ilike') && q.includes('ana\\_souza@exemplo.com'), true)
})
