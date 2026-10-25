// Unit tests — auth-check-handle Edge Function
// Roda com: deno test supabase/functions/auth-check-handle/index.test.ts --allow-env --allow-net
//
// Disponibilidade do @handle durante o cadastro: formato, limite por IP, e a regra de unicidade cruzada
// (usuário OU empresa ativa) igual à do auth-register e do company-create.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')

import { handleRequest } from './index.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }

function mockFetch(routes: MockRoute[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    for (const r of routes) {
      const methodOk = !r.method || r.method.toUpperCase() === method
      if (methodOk && url.includes(r.pattern)) {
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }
}

function withMock<T>(routes: MockRoute[], fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = mockFetch(routes) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

function makeReq(handle: unknown): Request {
  return new Request('http://localhost/auth-check-handle', { method: 'POST', body: JSON.stringify({ handle }) })
}

const RATE_OK: MockRoute = { pattern: '/rest/v1/audit_logs', method: 'GET', status: 200, body: [] }
const AUDIT_INSERT: MockRoute = { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} }
const USERS = (rows: unknown[]): MockRoute => ({ pattern: '/rest/v1/users', method: 'GET', status: 200, body: rows })
const COMPANIES = (rows: unknown[]): MockRoute => ({ pattern: '/rest/v1/companies', method: 'GET', status: 200, body: rows })

Deno.test('GET retorna 405', async () => {
  const res = await withMock([], () => handleRequest(new Request('http://localhost/auth-check-handle', { method: 'GET' })))
  assertEquals(res.status, 405)
})

Deno.test('formato inválido → 422 (sem tocar no banco)', async () => {
  for (const bad of ['', 'ab', '1abc', '_abc', 'abc_', 'a__b', 'tem espaco', 'x'.repeat(21), 'acentuação', null, 42]) {
    const res = await withMock([], () => handleRequest(makeReq(bad)))
    assertEquals(res.status, 422, String(bad))
  }
})

Deno.test('rate limit (60 checagens em 15min) → 429', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': '0-0/60' } })
    }
    return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    assertEquals((await handleRequest(makeReq('chocolateria'))).status, 429)
  } finally {
    globalThis.fetch = orig
  }
})

Deno.test('@ livre → { available: true } (aceita @ e maiúsculas)', async () => {
  for (const input of ['chocolateria', '@Chocolateria']) {
    const res  = await withMock([RATE_OK, AUDIT_INSERT, USERS([]), COMPANIES([])], () => handleRequest(makeReq(input)))
    assertEquals(res.status, 200)
    assertEquals((await res.json()).available, true)
  }
})

Deno.test('@ de usuário existente → { available: false }', async () => {
  const res = await withMock([RATE_OK, AUDIT_INSERT, USERS([{ id: 'u1' }]), COMPANIES([])], () => handleRequest(makeReq('fernando')))
  assertEquals((await res.json()).available, false)
})

Deno.test('@ de empresa ativa → { available: false }', async () => {
  const res = await withMock([RATE_OK, AUDIT_INSERT, USERS([]), COMPANIES([{ id: 'c1' }])], () => handleRequest(makeReq('chocolateria')))
  assertEquals((await res.json()).available, false)
})

Deno.test('empresa apagada não conta (consulta filtra deleted_at)', async () => {
  let companiesUrl = ''
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/rest/v1/companies')) companiesUrl = url
    return mockFetch([RATE_OK, AUDIT_INSERT, USERS([]), COMPANIES([])])(input, init)
  }) as typeof fetch
  try {
    const res = await handleRequest(makeReq('chocolateria'))
    assertEquals((await res.json()).available, true)
    assertEquals(companiesUrl.includes('deleted_at=is.null'), true)
  } finally {
    globalThis.fetch = orig
  }
})

Deno.test('@ reservado pelo Alber Food → { available: false }', async () => {
  const res = await withMock(
    [RATE_OK, AUDIT_INSERT, USERS([]), COMPANIES([]), { pattern: '/rest/v1/handle_reservations', method: 'GET', status: 200, body: [{ owner_ref: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] }],
    () => handleRequest(makeReq('chocolateria')),
  )
  assertEquals((await res.json()).available, false)
})

Deno.test('consulta o @ de usuário nas duas formas gravadas (com e sem "@")', async () => {
  let usersUrl = ''
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/rest/v1/users')) usersUrl = decodeURIComponent(url)
    return mockFetch([RATE_OK, AUDIT_INSERT, USERS([]), COMPANIES([])])(input, init)
  }) as typeof fetch
  try {
    await handleRequest(makeReq('fernando'))
    assertEquals(usersUrl.includes('fernando') && usersUrl.includes('@fernando'), true)
  } finally {
    globalThis.fetch = orig
  }
})
