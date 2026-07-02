// E2E unit tests — event-tickets-list Edge Function
// Roda com: deno test supabase/functions/event-tickets-list/index.test.ts --allow-env --allow-net

import { assertEquals, assertObjectMatch } from 'https://deno.land/std@0.208.0/assert/mod.ts'

// ── Env setup (lido dentro do handleRequest, não no nível de módulo) ──────────
Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'

// ── Mock factory ──────────────────────────────────────────────────────────────

type MockRoute = {
  pattern:  string
  method?:  string
  status:   number
  body:     unknown
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

const AUTH_USER   = { id: 'auth-uid-1', aud: 'authenticated', role: 'authenticated' }
const DB_USER     = [{ id: 'db-uid-1', auth_id: 'auth-uid-1' }]
const EVENT       = [{ id: 'evt-1', name: 'Festa', space_id: 'space-1', status: 'active', is_paid: true }]
const OWNER_SHIP  = [{ role: 'owner', status: 'active' }]
const MEMBER_SHIP = [{ role: 'member', status: 'active' }]
const TICKETS     = [
  {
    id: 'tkt-1', price_brl: '50.00', price_albers: '50.00', status: 'confirmed',
    purchased_at: '2026-07-01T12:00:00Z', batch_id: 'bat-1', user_id: 'db-uid-2',
    batch: { id: 'bat-1', batch_number: 1 },
    buyer: { id: 'db-uid-2', name: 'Ana Lima', handle: 'analima' },
  },
]

const BASE_ROUTES: MockRoute[] = [
  { pattern: '/auth/v1/user',           method: 'GET',  status: 200, body: AUTH_USER },
  { pattern: '/rest/v1/users',          method: 'GET',  status: 200, body: DB_USER },
  { pattern: '/rest/v1/events',         method: 'GET',  status: 200, body: EVENT },
  { pattern: '/rest/v1/space_members',  method: 'GET',  status: 200, body: OWNER_SHIP },
  { pattern: '/rest/v1/event_tickets',  method: 'GET',  status: 200, body: TICKETS },
  { pattern: '/rest/v1/audit_logs',     method: 'POST', status: 201, body: {} },
  { pattern: '/rest/v1/error_logs',     method: 'POST', status: 201, body: {} },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(opts: { method?: string; auth?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.auth !== null) headers['Authorization'] = opts.auth ?? 'Bearer valid-token'
  return new Request('http://localhost/event-tickets-list', {
    method:  opts.method ?? 'POST',
    headers,
    body:    opts.body !== undefined ? JSON.stringify(opts.body) : JSON.stringify({ event_id: 'evt-1' }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('CORS preflight retorna 200 com headers corretos', async () => {
  const req = new Request('http://localhost/event-tickets-list', { method: 'OPTIONS' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
})

Deno.test('método GET retorna 405', async () => {
  const req = new Request('http://localhost/event-tickets-list', {
    method:  'GET',
    headers: { 'Authorization': 'Bearer tok' },
  })
  const res  = await withMock([], () => handleRequest(req))
  const data = await res.json()
  assertEquals(res.status, 405)
  assertEquals(data.code, 'METHOD_NOT_ALLOWED')
})

Deno.test('sem header Authorization retorna 401', async () => {
  const req = new Request('http://localhost/event-tickets-list', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ event_id: 'evt-1' }),
  })
  const res = await withMock([], () => handleRequest(req))
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'UNAUTHORIZED')
})

Deno.test('token inválido (auth retorna 401) → 401', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 401, body: { message: 'invalid_jwt' } },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'UNAUTHORIZED')
})

Deno.test('body JSON inválido retorna 400', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = mockFetch([
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]) as typeof fetch
  try {
    const req = new Request('http://localhost/event-tickets-list', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer tok', 'Content-Type': 'application/json' },
      body:    'NOT_JSON',
    })
    const res  = await handleRequest(req)
    const data = await res.json()
    assertEquals(res.status, 400)
    assertEquals(data.code, 'INVALID_BODY')
  } finally {
    globalThis.fetch = orig
  }
})

Deno.test('event_id ausente retorna 400', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ body: {} })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'MISSING_FIELDS')
})

Deno.test('usuário não encontrado retorna 404', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('rest/v1/users')),
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'USER_NOT_FOUND')
})

Deno.test('evento não encontrado retorna 404', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('rest/v1/events')),
    { pattern: '/rest/v1/events', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'EVENT_NOT_FOUND')
})

Deno.test('usuário sem permissão (membro comum) retorna 403', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('space_members')),
    { pattern: '/rest/v1/space_members', method: 'GET', status: 200, body: MEMBER_SHIP },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'FORBIDDEN')
})

Deno.test('sem membership retorna 403', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('space_members')),
    { pattern: '/rest/v1/space_members', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'FORBIDDEN')
})

Deno.test('sucesso — retorna lista de confirmados com total', async () => {
  const res  = await withMock(BASE_ROUTES, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.event_id, 'evt-1')
  assertEquals(data.event_name, 'Festa')
  assertEquals(data.total, 1)
  assertEquals(data.total_brl, 50)
  assertEquals(data.tickets.length, 1)
  assertObjectMatch(data.tickets[0], {
    ticket_id:    'tkt-1',
    user_name:    'Ana Lima',
    user_handle:  '@analima',
    batch_name:   '1º Lote',
    price_brl:    50,
    price_albers: 50,
  })
})

Deno.test('sucesso — evento sem ingressos retorna lista vazia', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('event_tickets')),
    { pattern: '/rest/v1/event_tickets', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.total, 0)
  assertEquals(data.total_brl, 0)
  assertEquals(data.tickets, [])
})
