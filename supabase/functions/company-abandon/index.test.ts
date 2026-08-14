// E2E unit tests — company-abandon Edge Function
// Roda com: deno test supabase/functions/company-abandon/index.test.ts --allow-env --allow-net
//
// Plano velvet-puzzling-sedgewick (ciclo de vida do KYC de empresa): o master
// pode cancelar o próprio cadastro de empresa antes da aprovação do KYC,
// liberando o CNPJ/handle na hora (deleted_at).

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }

function mockFetch(routes: MockRoute[], onRequest?: (url: string, method: string, body: unknown) => void) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (onRequest) onRequest(url, method, init?.body ? JSON.parse(init.body as string) : null)
    for (const r of routes) {
      const methodOk = !r.method || r.method.toUpperCase() === method
      if (methodOk && url.includes(r.pattern)) {
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }
}

function withMock<T>(routes: MockRoute[], onRequest: ((url: string, method: string, body: unknown) => void) | undefined, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = mockFetch(routes, onRequest) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const AUTH_USER = { id: 'auth-uid-1', aud: 'authenticated' }

function makeReq(body: Record<string, unknown> = { company_id: 'c1' }): Request {
  return new Request('http://localhost/company-abandon', {
    method:  'POST',
    headers: { Authorization: 'Bearer valid-tok', 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/company-abandon', { method: 'GET' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/company-abandon', { method: 'POST', body: '{}' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('sem company_id → 400', async () => {
  const routes: MockRoute[] = [{ pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER }]
  const res = await withMock(routes, undefined, () => handleRequest(makeReq({})))
  assertEquals(res.status, 400)
})

Deno.test('empresa não encontrada → 404', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1' }] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [] },
  ]
  const res = await withMock(routes, undefined, () => handleRequest(makeReq()))
  assertEquals(res.status, 404)
})

Deno.test('operador (não-master) tentando abandonar → 403 FORBIDDEN', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'operator-1' }] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [{ id: 'c1', owner_id: 'master-1', kyc_status: 'pending', deleted_at: null }] },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'FORBIDDEN')
})

Deno.test('empresa já aprovada → 422 COMPANY_ALREADY_APPROVED (não cancela empresa ativa)', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'master-1' }] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [{ id: 'c1', owner_id: 'master-1', kyc_status: 'approved', deleted_at: null }] },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'COMPANY_ALREADY_APPROVED')
})

Deno.test('já abandonada (deleted_at preenchido) → 409 ALREADY_ABANDONED', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'master-1' }] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [{ id: 'c1', owner_id: 'master-1', kyc_status: 'rejected', deleted_at: '2026-01-01T00:00:00Z' }] },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 409)
  assertEquals(data.code, 'ALREADY_ABANDONED')
})

Deno.test('master cancelando cadastro pendente → 200, seta deleted_at', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'master-1' }] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [{ id: 'c1', owner_id: 'master-1', kyc_status: 'pending', deleted_at: null }] },
    { pattern: '/rest/v1/companies', method: 'PATCH', status: 200, body: [] },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
  ]
  const patchBodies: Record<string, unknown>[] = []
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/companies')) patchBodies.push(body as Record<string, unknown>)
  }, () => handleRequest(makeReq()))

  assertEquals(res.status, 200)
  assertEquals(typeof patchBodies[0]?.deleted_at, 'string')
})
