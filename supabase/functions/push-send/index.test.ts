// E2E unit tests — push-send Edge Function
// Roda com: deno test supabase/functions/push-send/index.test.ts --allow-env --allow-net
//
// Cobre o enforcement novo (item da revisão de QA sobre "restante dos toggles
// em Notificações"): antes disso, os toggles de Perfil > Notificações eram só
// de interface — desligar uma categoria não impedia nada de ser enviado.
// Agora push-send checa users.notif_<category> antes de inserir a notificação
// in-app e antes de chamar a Expo Push API.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')

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

function makeReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/push-send', {
    method:  'POST',
    headers: { Authorization: 'Bearer test-srk', 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

const ONE_TOKEN     = [{ id: 'tok-1', token: 'ExponentPushToken[xxx]' }]
const EXPO_OK       = { data: [{ status: 'ok' }] }
const NOTIF_INSERT  = { pattern: '/rest/v1/notifications', method: 'POST', status: 201, body: {} }
const TOKENS_ROUTE  = { pattern: '/rest/v1/push_tokens', method: 'GET', status: 200, body: ONE_TOKEN }
const EXPO_ROUTE    = { pattern: 'exp.host', method: 'POST', status: 200, body: EXPO_OK }

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/push-send', { method: 'GET' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization de service role → 401', async () => {
  const req = new Request('http://localhost/push-send', { method: 'POST', body: '{}' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('campos obrigatórios ausentes → 400', async () => {
  const res = await withMock([], undefined, () => handleRequest(makeReq({})))
  assertEquals(res.status, 400)
})

Deno.test('sem category (não-configurável) → sempre envia, mesmo sem checar preferência', async () => {
  let userPrefQueried = false
  const routes = [NOTIF_INSERT, TOKENS_ROUTE, EXPO_ROUTE]
  const res = await withMock(routes, (url) => {
    if (url.includes('/rest/v1/users')) userPrefQueried = true
  }, () => handleRequest(makeReq({ user_id: 'u1', title: 'PIN alterado', body: 'msg' })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.sent, 1)
  assertEquals(userPrefQueried, false)
})

Deno.test('category com preferência ligada (true) → envia normalmente', async () => {
  const routes = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ notif_split_closed: true }] },
    NOTIF_INSERT, TOKENS_ROUTE, EXPO_ROUTE,
  ]
  const res = await withMock(routes, undefined, () =>
    handleRequest(makeReq({ user_id: 'u1', title: 'Split encerrado', body: 'msg', category: 'split_closed' })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.sent, 1)
})

Deno.test('category com preferência desligada (false) → não insere notificação nem chama Expo (muted)', async () => {
  let notificationInserted = false
  let expoCalled = false
  const routes = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ notif_split_closed: false }] },
    NOTIF_INSERT, TOKENS_ROUTE, EXPO_ROUTE,
  ]
  const res = await withMock(routes, (url, method) => {
    if (url.includes('/rest/v1/notifications') && method === 'POST') notificationInserted = true
    if (url.includes('exp.host')) expoCalled = true
  }, () => handleRequest(makeReq({ user_id: 'u1', title: 'Split encerrado', body: 'msg', category: 'split_closed' })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.reason, 'muted')
  assertEquals(notificationInserted, false)
  assertEquals(expoCalled, false)
})

Deno.test('linha de usuário não encontrada (edge case) → trata como habilitado, não bloqueia por segurança', async () => {
  const routes = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
    NOTIF_INSERT, TOKENS_ROUTE, EXPO_ROUTE,
  ]
  const res = await withMock(routes, undefined, () =>
    handleRequest(makeReq({ user_id: 'u1', title: 'Split encerrado', body: 'msg', category: 'split_closed' })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.sent, 1)
})

Deno.test('sem tokens ativos → 200 sent:0 reason:no_tokens (continua registrando in-app)', async () => {
  let notificationInserted = false
  const routes = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ notif_tx_receive: true }] },
    NOTIF_INSERT,
    { pattern: '/rest/v1/push_tokens', method: 'GET', status: 200, body: [] },
  ]
  const res = await withMock(routes, (url, method) => {
    if (url.includes('/rest/v1/notifications') && method === 'POST') notificationInserted = true
  }, () => handleRequest(makeReq({ user_id: 'u1', title: 'Transferência recebida', body: 'msg', category: 'tx_receive' })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.reason, 'no_tokens')
  assertEquals(notificationInserted, true)
})
