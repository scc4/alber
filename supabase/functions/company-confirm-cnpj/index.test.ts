// E2E unit tests — company-confirm-cnpj Edge Function
// Roda com: deno test supabase/functions/company-confirm-cnpj/index.test.ts --allow-env --allow-net
//
// Empresas cadastradas antes de companies.cnpj_masked existir não têm esse
// campo salvo (só o hash é guardado) — este endpoint deixa master ou
// operador ativo confirmar o CNPJ; se o hash bater, persiste a versão
// mascarada.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'
import { sha256hex } from '../_shared/crypto.ts'

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

const AUTH_UUID  = '11111111-1111-4111-8111-111111111111'
const AUTH_USER  = { id: AUTH_UUID, aud: 'authenticated' }
const CALLER     = { id: 'user-1', auth_id: AUTH_UUID }
const COMPANY_ID = 'company-1'
const VALID_CNPJ = '11222333000181' // dígito verificador válido conforme _shared/cnpj.ts

const RATE_OK      = { pattern: '/rest/v1/audit_logs', method: 'GET',  status: 200, body: [] }
const AUDIT_INSERT = { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} }

function company(overrides: Record<string, unknown> = {}) {
  return { id: COMPANY_ID, owner_id: CALLER.id, cnpj: null, ...overrides }
}

function makeReq(body: Record<string, unknown> = {}, token = 'valid-tok'): Request {
  return new Request('http://localhost/company-confirm-cnpj', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: COMPANY_ID, cnpj: VALID_CNPJ, ...body }),
  })
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/company-confirm-cnpj', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/company-confirm-cnpj', { method: 'POST', body: '{}' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('CNPJ com formato inválido → 422 CNPJ_INVALID', async () => {
  const routes: MockRoute[] = [{ pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER }]
  const res  = await withMock(routes, () => handleRequest(makeReq({ cnpj: '111' })))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'CNPJ_INVALID')
})

Deno.test('empresa não encontrada → 404 COMPANY_NOT_FOUND', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',      method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',     method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'COMPANY_NOT_FOUND')
})

Deno.test('caller não é master nem operador ativo → 403 FORBIDDEN', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',            method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',           method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies',       method: 'GET', status: 200, body: [company({ owner_id: 'other-user' })] },
    { pattern: '/rest/v1/company_operators', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'FORBIDDEN')
})

Deno.test('operador ativo (sem ser master) pode confirmar', async () => {
  const cnpjHash = await sha256hex(VALID_CNPJ)
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',              method: 'GET',   status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',             method: 'GET',   status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies',         method: 'GET',   status: 200, body: [company({ owner_id: 'other-user', cnpj: cnpjHash })] },
    { pattern: '/rest/v1/company_operators', method: 'GET',   status: 200, body: [{ id: 'op-1' }] },
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/companies',         method: 'PATCH', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.cnpj_masked, '**.***.***/0001-81')
})

Deno.test('CNPJ não confere com o hash salvo → 422 CNPJ_MISMATCH', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',      method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',     method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [company({ cnpj: 'hash-de-outro-cnpj' })] },
    RATE_OK, AUDIT_INSERT,
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'CNPJ_MISMATCH')
})

Deno.test('CNPJ confere (master) → 200 com cnpj_masked', async () => {
  const cnpjHash = await sha256hex(VALID_CNPJ)
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',      method: 'GET',   status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',     method: 'GET',   status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies', method: 'GET',   status: 200, body: [company({ cnpj: cnpjHash })] },
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/companies', method: 'PATCH', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.cnpj_masked, '**.***.***/0001-81')
})

Deno.test('rate limit (10 tentativas em 15min) → 429', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',      method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',     method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [company()] },
  ]
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': '0-0/10' } })
    }
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  try {
    const res = await handleRequest(makeReq())
    assertEquals(res.status, 429)
  } finally {
    globalThis.fetch = orig
  }
})
