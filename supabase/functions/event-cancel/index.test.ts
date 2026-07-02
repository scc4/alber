// E2E unit tests — event-cancel Edge Function
// Roda com: deno test supabase/functions/event-cancel/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')

import { handleRequest } from './index.ts'

// ── Mock factory ──────────────────────────────────────────────────────────────

type MockRoute = {
  pattern: string
  method?: string
  status:  number
  body:    unknown
}

function mockFetch(routes: MockRoute[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET')).toUpperCase()
    for (const r of routes) {
      const methodOk = !r.method || r.method.toUpperCase() === method
      if (methodOk && url.includes(r.pattern)) {
        return new Response(JSON.stringify(r.body), {
          status:  r.status,
          headers: { 'Content-Type': 'application/json' },
        })
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AUTH_USER   = { id: 'auth-uid-1', aud: 'authenticated' }
const DB_CALLER   = [{ id: 'db-uid-1', auth_id: 'auth-uid-1' }]
const FREE_EVENT  = [{ id: 'evt-1', name: 'Roda de Viola', space_id: 'space-1', is_paid: false, status: 'active' }]
const OWNER_SHIP  = [{ role: 'owner', status: 'active', user_id: 'db-uid-1' }]
const MEMBER_SHIP = [{ role: 'member', status: 'active' }]

// Rota base para cancelamento de evento GRATUITO (sem Asaas)
const BASE_FREE_ROUTES: MockRoute[] = [
  { pattern: '/auth/v1/user',          method: 'GET',   status: 200, body: AUTH_USER },
  { pattern: '/rest/v1/users',         method: 'GET',   status: 200, body: DB_CALLER },
  { pattern: '/rest/v1/events',        method: 'GET',   status: 200, body: FREE_EVENT },
  { pattern: '/rest/v1/space_members', method: 'GET',   status: 200, body: OWNER_SHIP },
  { pattern: '/rest/v1/event_tickets', method: 'GET',   status: 200, body: [] },
  { pattern: '/rest/v1/event_tickets', method: 'PATCH', status: 200, body: [] },
  { pattern: '/rest/v1/events',        method: 'PATCH', status: 200, body: [{ id: 'evt-1', status: 'cancelled' }] },
  { pattern: '/rest/v1/event_batches', method: 'PATCH', status: 200, body: [] },
  { pattern: '/rest/v1/audit_logs',    method: 'POST',  status: 201, body: {} },
  { pattern: '/rest/v1/error_logs',    method: 'POST',  status: 201, body: {} },
  { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
]

function makeReq(opts: { method?: string; body?: unknown } = {}): Request {
  return new Request('http://localhost/event-cancel', {
    method:  opts.method ?? 'POST',
    headers: { 'Authorization': 'Bearer valid-tok', 'Content-Type': 'application/json' },
    body:    opts.body !== undefined ? JSON.stringify(opts.body) : JSON.stringify({ event_id: 'evt-1' }),
  })
}

// ── Tests — validação estrutural ──────────────────────────────────────────────

Deno.test('CORS preflight retorna 200', async () => {
  const req = new Request('http://localhost/event-cancel', { method: 'OPTIONS' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 200)
})

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/event-cancel', {
    method:  'GET',
    headers: { 'Authorization': 'Bearer tok' },
  })
  const res  = await withMock([], () => handleRequest(req))
  const data = await res.json()
  assertEquals(res.status, 405)
  assertEquals(data.code, 'METHOD_NOT_ALLOWED')
})

Deno.test('sem Authorization retorna 401', async () => {
  const req = new Request('http://localhost/event-cancel', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ event_id: 'evt-1' }),
  })
  const res  = await withMock([], () => handleRequest(req))
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'UNAUTHORIZED')
})

Deno.test('token inválido → 401', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 401, body: { message: 'invalid' } },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'UNAUTHORIZED')
})

Deno.test('JSON inválido → 400', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = mockFetch([
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]) as typeof fetch
  try {
    const req = new Request('http://localhost/event-cancel', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer tok', 'Content-Type': 'application/json' },
      body:    '{bad json',
    })
    const res  = await handleRequest(req)
    const data = await res.json()
    assertEquals(res.status, 400)
    assertEquals(data.code, 'INVALID_BODY')
  } finally {
    globalThis.fetch = orig
  }
})

Deno.test('event_id ausente → 400', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ body: {} })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'MISSING_FIELDS')
})

// ── Tests — lógica de negócio ─────────────────────────────────────────────────

Deno.test('usuário não encontrado → 404', async () => {
  const routes: MockRoute[] = [
    ...BASE_FREE_ROUTES.filter(r => !r.pattern.includes('rest/v1/users') || r.method !== 'GET'),
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'USER_NOT_FOUND')
})

Deno.test('evento não encontrado → 404', async () => {
  const routes: MockRoute[] = [
    ...BASE_FREE_ROUTES.filter(r => !r.pattern.includes('rest/v1/events') || r.method !== 'GET'),
    { pattern: '/rest/v1/events', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'EVENT_NOT_FOUND')
})

Deno.test('evento já cancelado → 404', async () => {
  const cancelled = [{ id: 'evt-1', name: 'X', space_id: 'space-1', is_paid: false, status: 'cancelled' }]
  const routes: MockRoute[] = [
    ...BASE_FREE_ROUTES.filter(r => !r.pattern.includes('rest/v1/events') || r.method !== 'GET'),
    { pattern: '/rest/v1/events', method: 'GET', status: 200, body: cancelled },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'EVENT_NOT_FOUND')
})

Deno.test('membro comum (sem permissão) → 403', async () => {
  const routes: MockRoute[] = [
    ...BASE_FREE_ROUTES.filter(r => !r.pattern.includes('space_members')),
    { pattern: '/rest/v1/space_members', method: 'GET', status: 200, body: MEMBER_SHIP },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'FORBIDDEN')
})

Deno.test('sem membership → 403', async () => {
  const routes: MockRoute[] = [
    ...BASE_FREE_ROUTES.filter(r => !r.pattern.includes('space_members')),
    { pattern: '/rest/v1/space_members', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'FORBIDDEN')
})

Deno.test('cancelamento bem-sucedido — evento gratuito sem ingressos → 200', async () => {
  const res  = await withMock(BASE_FREE_ROUTES, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.cancelled, true)
  assertEquals(data.event_id, 'evt-1')
  assertEquals(data.refunded_count, 0)
  assertEquals(data.total_tickets, 0)
})

Deno.test('cancelamento com ingressos gratuitos — marca todos como refunded → 200', async () => {
  const freeTickets = [
    { id: 'tkt-f1', user_id: 'u1', price_albers: '0', price_brl: '0' },
    { id: 'tkt-f2', user_id: 'u2', price_albers: '0', price_brl: '0' },
  ]
  const routes: MockRoute[] = [
    ...BASE_FREE_ROUTES.filter(r => !r.pattern.includes('event_tickets') || r.method !== 'GET'),
    { pattern: '/rest/v1/event_tickets', method: 'GET',  status: 200, body: freeTickets },
    { pattern: '/rest/v1/event_tickets', method: 'PATCH', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.cancelled, true)
  assertEquals(data.total_tickets, 2)
  // Ingressos gratuitos não incrementam refunded_count (sem transferência Asaas)
  assertEquals(data.refunded_count, 0)
})

Deno.test('manager também pode cancelar → 200', async () => {
  const managerShip = [{ role: 'admin', status: 'active', user_id: 'db-uid-1' }]
  const routes: MockRoute[] = [
    ...BASE_FREE_ROUTES.filter(r => !r.pattern.includes('space_members')),
    { pattern: '/rest/v1/space_members', method: 'GET', status: 200, body: managerShip },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.cancelled, true)
})
