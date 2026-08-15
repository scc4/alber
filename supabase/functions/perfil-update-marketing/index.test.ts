// E2E unit tests — perfil-update-marketing Edge Function
// Roda com: deno test supabase/functions/perfil-update-marketing/index.test.ts --allow-env --allow-net
//
// Item 19 da revisão de QA: consentimento de marketing precisa ser
// revogável a qualquer momento (LGPD), separado do aceite obrigatório do
// cadastro.

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

function makeReq(body: Record<string, unknown>, token = 'valid-tok'): Request {
  return new Request('http://localhost/perfil-update-marketing', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/perfil-update-marketing', { method: 'GET' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/perfil-update-marketing', { method: 'POST', body: '{}' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('marketing_opt_in ausente/não-booleano → 400 MISSING_FIELDS', async () => {
  const routes: MockRoute[] = [{ pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER }]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq({})))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'MISSING_FIELDS')
})

Deno.test('usuário não encontrado → 404', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res = await withMock(routes, undefined, () => handleRequest(makeReq({ marketing_opt_in: true })))
  assertEquals(res.status, 404)
})

Deno.test('conta excluída → 404 (não permite alterar preferência de conta encerrada)', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', deleted_at: '2026-01-01T00:00:00Z' }] },
  ]
  const res = await withMock(routes, undefined, () => handleRequest(makeReq({ marketing_opt_in: true })))
  assertEquals(res.status, 404)
})

Deno.test('liga o consentimento → 200, grava marketing_opt_in true + updated_at', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', deleted_at: null }] },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
  ]
  const patchBodies: Record<string, unknown>[] = []
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/users')) patchBodies.push(body as Record<string, unknown>)
  }, () => handleRequest(makeReq({ marketing_opt_in: true })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.marketing_opt_in, true)
  assertEquals(patchBodies[0]?.marketing_opt_in, true)
  assertEquals(typeof patchBodies[0]?.marketing_opt_in_updated_at, 'string')
})

Deno.test('desliga o consentimento → 200, grava marketing_opt_in false', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', deleted_at: null }] },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
  ]
  const patchBodies: Record<string, unknown>[] = []
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/users')) patchBodies.push(body as Record<string, unknown>)
  }, () => handleRequest(makeReq({ marketing_opt_in: false })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.marketing_opt_in, false)
  assertEquals(patchBodies[0]?.marketing_opt_in, false)
})
