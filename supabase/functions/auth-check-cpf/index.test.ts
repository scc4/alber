// E2E unit tests — auth-check-cpf Edge Function
// Roda com: deno test supabase/functions/auth-check-cpf/index.test.ts --allow-env --allow-net
//
// Melhoria 1: primeiro passo do cadastro de empresa. Cobre o caso feliz (CPF
// novo/existente) e as guardas (CPF inválido, rate limit, conta excluída não
// conta como existente — deleted_at retido por obrigação legal não deve
// travar quem já teve a conta apagada).

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

const VALID_CPF = '52998224725' // válido conforme utils/cpf.ts — dígito verificador correto

function makeReq(cpf: string): Request {
  return new Request('http://localhost/auth-check-cpf', {
    method: 'POST',
    body:   JSON.stringify({ cpf }),
  })
}

const RATE_OK: MockRoute = { pattern: '/rest/v1/audit_logs', method: 'GET', status: 200, body: [] }
const AUDIT_INSERT: MockRoute = { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} }

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/auth-check-cpf', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('CPF inválido → 422', async () => {
  const res = await withMock([RATE_OK], () => handleRequest(makeReq('11111111111')))
  assertEquals(res.status, 422)
})

Deno.test('rate limit (10 tentativas em 15min) → 429', async () => {
  // A checagem de contagem usa .select(..., { count: 'exact', head: true }),
  // que o supabase-js traduz para um HEAD request lendo o total do header
  // 'content-range' (formato "0-0/N") — não do body.
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': '0-0/10' } })
    }
    return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    const res = await handleRequest(makeReq(VALID_CPF))
    assertEquals(res.status, 429)
  } finally {
    globalThis.fetch = orig
  }
})

Deno.test('CPF sem conta → { exists: false }', async () => {
  const routes: MockRoute[] = [
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq(VALID_CPF)))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.exists, false)
})

Deno.test('CPF com conta ativa → { exists: true }', async () => {
  const routes: MockRoute[] = [
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1' }] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq(VALID_CPF)))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.exists, true)
})

Deno.test('CPF de conta excluída (filtrada por deleted_at) → { exists: false }', async () => {
  // O mock de /rest/v1/users sempre retorna [] aqui porque a query real já
  // filtra deleted_at=is.null — simulamos o resultado pós-filtro (não a
  // query em si, que é coberta pela asserção de URL abaixo).
  let queryUrl = ''
  const routes: MockRoute[] = [
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/rest/v1/users')) queryUrl = url
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  try {
    const res  = await handleRequest(makeReq(VALID_CPF))
    const data = await res.json()
    assertEquals(res.status, 200)
    assertEquals(data.exists, false)
    assertEquals(queryUrl.includes('deleted_at=is.null'), true)
  } finally {
    globalThis.fetch = orig
  }
})
