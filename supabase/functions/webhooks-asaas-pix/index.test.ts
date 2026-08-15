// E2E unit tests — webhooks-asaas-pix Edge Function
// Roda com: deno test supabase/functions/webhooks-asaas-pix/index.test.ts --allow-env --allow-net
//
// Cobre a correção do bug do evento inválido: a Asaas não tem um evento
// TRANSFER_CONFIRMED (só TRANSFER_DONE) — o nome errado quebrava a criação de
// TODA subconta (POST /accounts rejeitava o payload de webhooks), derrubando
// 100% dos cadastros. Aqui garantimos que o handler reage a TRANSFER_DONE (e
// não mais ao nome antigo, inclusive como guarda de regressão).

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('ASAAS_WEBHOOK_SECRET', 'test-webhook-secret')

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

function makeReq(payload: Record<string, unknown>, token = 'test-webhook-secret'): Request {
  return new Request('http://localhost/webhooks-asaas-pix', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'asaas-access-token': token },
    body:    JSON.stringify(payload),
  })
}

const PROCESSING_TX = { id: 'tx-1', user_id: 'u1', status: 'processing', amount: 100 }

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/webhooks-asaas-pix', { method: 'GET' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('token inválido → 401', async () => {
  const res = await withMock([], undefined, () =>
    handleRequest(makeReq({ event: 'TRANSFER_DONE', transfer: { id: 't1', status: 'DONE', value: 10 } }, 'wrong-token')))
  assertEquals(res.status, 401)
})

Deno.test('TRANSFER_DONE com transação processing → completed', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/transactions', method: 'GET', status: 200, body: [PROCESSING_TX] },
    { pattern: '/rest/v1/transactions', method: 'PATCH', status: 200, body: [] },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
    { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
  ]
  const patchBodies: Record<string, unknown>[] = []
  const auditBodies: Record<string, unknown>[] = []
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/transactions')) patchBodies.push(body as Record<string, unknown>)
    if (method === 'POST' && url.includes('/rest/v1/audit_logs')) auditBodies.push(body as Record<string, unknown>)
  }, () => handleRequest(makeReq({ event: 'TRANSFER_DONE', transfer: { id: 't1', status: 'DONE', value: 10 } })))

  assertEquals(res.status, 200)
  assertEquals(patchBodies[0]?.status, 'completed')
  assertEquals(auditBodies[0]?.event_type, 'descarregar_completed')
})

Deno.test('TRANSFER_FAILED com transação processing → failed', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/transactions', method: 'GET', status: 200, body: [PROCESSING_TX] },
    { pattern: '/rest/v1/transactions', method: 'PATCH', status: 200, body: [] },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
    { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
  ]
  const patchBodies: Record<string, unknown>[] = []
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/transactions')) patchBodies.push(body as Record<string, unknown>)
  }, () => handleRequest(makeReq({ event: 'TRANSFER_FAILED', transfer: { id: 't1', status: 'FAILED', value: 10 } })))

  assertEquals(res.status, 200)
  assertEquals(patchBodies[0]?.status, 'failed')
})

// Guarda de regressão: o nome antigo (inválido na Asaas) não deve mais ser
// reconhecido como evento de transferência — se alguém reintroduzir
// 'TRANSFER_CONFIRMED' em vez de 'TRANSFER_DONE', este teste falha porque a
// transação processing NUNCA seria tocada (nem update, nem audit_log).
Deno.test('TRANSFER_CONFIRMED (nome antigo/inválido) não é mais tratado como conclusão', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/transactions', method: 'GET', status: 200, body: [PROCESSING_TX] },
  ]
  let patchCalled = false
  const res = await withMock(routes, (url, method) => {
    if (method === 'PATCH' && url.includes('/rest/v1/transactions')) patchCalled = true
  }, () => handleRequest(makeReq({ event: 'TRANSFER_CONFIRMED', transfer: { id: 't1', status: 'CONFIRMED', value: 10 } })))

  assertEquals(res.status, 200)
  assertEquals(patchCalled, false)
})

Deno.test('TRANSFER_DONE sem transação correspondente (idempotência) → 200 sem update', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/transactions', method: 'GET', status: 200, body: [] },
  ]
  let patchCalled = false
  const res = await withMock(routes, (url, method) => {
    if (method === 'PATCH') patchCalled = true
  }, () => handleRequest(makeReq({ event: 'TRANSFER_DONE', transfer: { id: 't1', status: 'DONE', value: 10 } })))

  assertEquals(res.status, 200)
  assertEquals(patchCalled, false)
})
