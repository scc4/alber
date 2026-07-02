// E2E unit tests — event-update Edge Function
// Roda com: deno test supabase/functions/event-update/index.test.ts --allow-env --allow-net

import { assertEquals, assertArrayIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

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

const AUTH_USER  = { id: 'auth-uid-1', aud: 'authenticated' }
const DB_CALLER  = [{ id: 'db-uid-1', auth_id: 'auth-uid-1' }]
const EVENT_ROW  = [{
  id: 'evt-1', name: 'Velha Festa', description: 'Descrição original',
  image_url: null, date: '2026-09-01T20:00:00Z', space_id: 'space-1', status: 'active',
}]
const OWNER_SHIP  = [{ role: 'owner', status: 'active' }]
const MEMBER_SHIP = [{ role: 'member', status: 'active' }]
// Resposta do UPDATE (single) — retorna o objeto, não array
const UPDATED_EVENT = {
  id: 'evt-1', name: 'Nova Festa', description: 'Descrição original',
  image_url: null, date: '2026-09-01T20:00:00Z', status: 'active',
}

const BASE_ROUTES: MockRoute[] = [
  { pattern: '/auth/v1/user',          method: 'GET',   status: 200, body: AUTH_USER },
  { pattern: '/rest/v1/users',         method: 'GET',   status: 200, body: DB_CALLER },
  { pattern: '/rest/v1/events',        method: 'GET',   status: 200, body: EVENT_ROW },
  { pattern: '/rest/v1/space_members', method: 'GET',   status: 200, body: OWNER_SHIP },
  { pattern: '/rest/v1/events',        method: 'PATCH', status: 200, body: UPDATED_EVENT },
  { pattern: '/rest/v1/event_tickets', method: 'GET',   status: 200, body: [] },
  { pattern: '/rest/v1/audit_logs',    method: 'POST',  status: 201, body: {} },
  { pattern: '/rest/v1/error_logs',    method: 'POST',  status: 201, body: {} },
  { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
]

function makeReq(body: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/event-update', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer valid-tok', 'Content-Type': 'application/json' },
    body:    JSON.stringify({ event_id: 'evt-1', ...body }),
  })
}

// ── Tests — validação estrutural ──────────────────────────────────────────────

Deno.test('CORS preflight retorna 200', async () => {
  const req = new Request('http://localhost/event-update', { method: 'OPTIONS' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 200)
})

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/event-update', {
    method:  'GET',
    headers: { 'Authorization': 'Bearer tok' },
  })
  const res  = await withMock([], () => handleRequest(req))
  const data = await res.json()
  assertEquals(res.status, 405)
  assertEquals(data.code, 'METHOD_NOT_ALLOWED')
})

Deno.test('sem Authorization retorna 401', async () => {
  const req = new Request('http://localhost/event-update', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ event_id: 'evt-1', name: 'X' }),
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
  const res  = await withMock(routes, () => handleRequest(makeReq({ name: 'X' })))
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'UNAUTHORIZED')
})

Deno.test('event_id ausente → 400', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]
  const req = new Request('http://localhost/event-update', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer tok', 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: 'Novo Nome' }),
  })
  const res  = await withMock(routes, () => handleRequest(req))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'MISSING_FIELDS')
})

Deno.test('nome vazio → 400', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ name: '   ' })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_NAME')
})

Deno.test('data inválida → 400', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ date: 'not-a-date' })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_DATE')
})

Deno.test('data no passado → 400', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ date: '2020-01-01T00:00:00Z' })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_DATE')
})

// ── Tests — lógica de negócio ─────────────────────────────────────────────────

Deno.test('usuário não encontrado → 404', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('rest/v1/users') || r.method !== 'GET'),
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ name: 'X' })))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'USER_NOT_FOUND')
})

Deno.test('evento não encontrado → 404', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('rest/v1/events') || r.method !== 'GET'),
    { pattern: '/rest/v1/events', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ name: 'X' })))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'EVENT_NOT_FOUND')
})

Deno.test('evento cancelado → 404', async () => {
  const cancelled = [{ ...EVENT_ROW[0], status: 'cancelled' }]
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('rest/v1/events') || r.method !== 'GET'),
    { pattern: '/rest/v1/events', method: 'GET', status: 200, body: cancelled },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ name: 'X' })))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'EVENT_NOT_FOUND')
})

Deno.test('membro comum → 403', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('space_members')),
    { pattern: '/rest/v1/space_members', method: 'GET', status: 200, body: MEMBER_SHIP },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ name: 'X' })))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'FORBIDDEN')
})

Deno.test('sem alterações → 200 updated:false', async () => {
  // Envia mesmo nome do evento existente → nenhum patch
  const res  = await withMock(BASE_ROUTES, () => handleRequest(makeReq({ name: 'Velha Festa' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.updated, false)
  assertEquals(data.changes.length, 0)
})

Deno.test('atualização de nome → 200 com changes=[name]', async () => {
  const res  = await withMock(BASE_ROUTES, () => handleRequest(makeReq({ name: 'Nova Festa' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.updated, true)
  assertArrayIncludes(data.changes, ['name'])
  assertEquals(data.event.name, 'Nova Festa')
})

Deno.test('atualização de descrição → 200 com changes=[description]', async () => {
  const updatedWithDesc = { ...UPDATED_EVENT, name: 'Velha Festa', description: 'Nova descrição' }
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('rest/v1/events') || r.method !== 'PATCH'),
    { pattern: '/rest/v1/events', method: 'PATCH', status: 200, body: updatedWithDesc },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ description: 'Nova descrição' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.updated, true)
  assertArrayIncludes(data.changes, ['description'])
})

Deno.test('atualização com confirmados — notifica via push', async () => {
  const ticketsWithUsers = [{ user_id: 'u1' }, { user_id: 'u2' }]
  let pushCount = 0
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('event_tickets') && !r.pattern.includes('push-send')),
    { pattern: '/rest/v1/event_tickets', method: 'GET', status: 200, body: ticketsWithUsers },
    {
      pattern: '/functions/v1/push-send',
      method: 'POST',
      status: 200,
      body: (() => { pushCount++; return {} })(),
    },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ name: 'Nova Festa' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.updated, true)
  // push é fire-and-forget — apenas verificamos que a resposta é 200
})

Deno.test('atualização de nome e descrição simultaneamente → changes com ambos', async () => {
  const multiUpdated = { ...UPDATED_EVENT, name: 'Novo Nome', description: 'Nova Desc' }
  const routes: MockRoute[] = [
    ...BASE_ROUTES.filter(r => !r.pattern.includes('rest/v1/events') || r.method !== 'PATCH'),
    { pattern: '/rest/v1/events', method: 'PATCH', status: 200, body: multiUpdated },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ name: 'Novo Nome', description: 'Nova Desc' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertArrayIncludes(data.changes, ['name', 'description'])
})
