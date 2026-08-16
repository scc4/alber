// E2E unit tests — perfil-update-notification-prefs Edge Function
// Roda com: deno test supabase/functions/perfil-update-notification-prefs/index.test.ts --allow-env --allow-net

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
  return new Request('http://localhost/perfil-update-notification-prefs', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/perfil-update-notification-prefs', { method: 'GET' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/perfil-update-notification-prefs', { method: 'POST', body: '{}' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('nenhum campo válido → 400 MISSING_FIELDS', async () => {
  const routes: MockRoute[] = [{ pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER }]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq({ nao_existe: true })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'MISSING_FIELDS')
})

Deno.test('campo com valor não-booleano → 400 INVALID_FIELD', async () => {
  const routes: MockRoute[] = [{ pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER }]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq({ notif_split_closed: 'sim' })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_FIELD')
})

Deno.test('usuário não encontrado → 404', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res = await withMock(routes, undefined, () => handleRequest(makeReq({ notif_split_closed: true })))
  assertEquals(res.status, 404)
})

Deno.test('atualiza só o subconjunto enviado, sem tocar nos outros campos', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', deleted_at: null }] },
    {
      pattern: '/rest/v1/users', method: 'PATCH', status: 200,
      body: { notif_split_closed: true, notif_tx_receive: true, notif_tx_send: true, notif_tx_carregar: true, notif_tx_descarregar: true, notif_split_participant: true, notif_split_expired: true, notif_lounge_message: true, notif_lounge_event: true, notif_lounge_request: false, notif_conta_kyc: true },
    },
  ]
  const patchBodies: Record<string, unknown>[] = []
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/users')) patchBodies.push(body as Record<string, unknown>)
  }, () => handleRequest(makeReq({ notif_split_closed: true })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.notif_split_closed, true)
  assertEquals(Object.keys(patchBodies[0] ?? {}), ['notif_split_closed'])
})

Deno.test('atualiza múltiplos campos de uma vez', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', deleted_at: null }] },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: { notif_lounge_message: false, notif_lounge_request: true } },
  ]
  const patchBodies: Record<string, unknown>[] = []
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/users')) patchBodies.push(body as Record<string, unknown>)
  }, () => handleRequest(makeReq({ notif_lounge_message: false, notif_lounge_request: true })))

  assertEquals(res.status, 200)
  assertEquals(patchBodies[0]?.notif_lounge_message, false)
  assertEquals(patchBodies[0]?.notif_lounge_request, true)
})
