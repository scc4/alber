// E2E unit tests — perfil-update-pin Edge Function
// Roda com: deno test supabase/functions/perfil-update-pin/index.test.ts --allow-env --allow-net
//
// Cobre em especial a correção de um bug real encontrado durante o trabalho
// no fluxo de exclusão de conta: signOut(jwt, scope) espera um JWT, mas o
// código chamava signOut(authUser.id, 'global') — passando um UUID onde a
// API espera um token. Isso fazia a chamada falhar silenciosamente (estava
// em try/catch não-crítico) e as sessões NÃO eram de fato revogadas após
// trocar o PIN. O fix usa o JWT da própria requisição.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'
import { bcryptHash } from '../_shared/crypto.ts'

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

const AUTH_UUID = '11111111-1111-4111-8111-111111111111'
const AUTH_USER = { id: AUTH_UUID, aud: 'authenticated' }
const CURRENT_PIN = 'a'.repeat(64)
const NEW_PIN     = 'c'.repeat(64)
const SEC_HASH    = 'b'.repeat(64)

function makeReq(body: Record<string, unknown> = {}, token = 'valid-tok'): Request {
  return new Request('http://localhost/perfil-update-pin', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      current_pin_hash:     CURRENT_PIN,
      new_pin_hash:         NEW_PIN,
      security_answer_hash: SEC_HASH,
      sms_code:             '123456',
      ...body,
    }),
  })
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/perfil-update-pin', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/perfil-update-pin', { method: 'POST', body: '{}' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('novo PIN igual ao atual → 422 PIN_SAME (checagem local, antes de bater no banco de usuários)', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ new_pin_hash: CURRENT_PIN })))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'PIN_SAME')
})

Deno.test('fluxo completo com sucesso: revoga sessão com o JWT da requisição, não com o user id', async () => {
  const nowIso = new Date(Date.now() + 5 * 60_000).toISOString()
  const currentPinBcrypt = await bcryptHash(CURRENT_PIN)
  const secBcrypt = await bcryptHash(SEC_HASH, 6)

  let signOutJwtUsed: string | null = null
  let signOutScopeUsed: string | null = null

  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'db-user-1', auth_id: AUTH_UUID }] },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: AUTH_UUID, app_metadata: { pin_bcrypt: currentPinBcrypt } } },
    { pattern: '/rest/v1/security_questions', method: 'GET', status: 200, body: [{ answer_hash: secBcrypt }] },
    { pattern: '/rest/v1/sms_codes', method: 'GET', status: 200, body: [{ id: 'sms-1', code: '123456', expires_at: nowIso, used_at: null }] },
    { pattern: '/rest/v1/sms_codes', method: 'PATCH', status: 200, body: [] },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
    { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
  ]

  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'PUT' && url.includes('/auth/v1/admin/users/')) {
      return new Response(JSON.stringify({ id: AUTH_UUID }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (method === 'POST' && url.includes('/auth/v1/logout')) {
      signOutJwtUsed   = init?.headers ? (init.headers as Record<string, string>)['Authorization'] ?? null : null
      signOutScopeUsed = new URL(url).searchParams.get('scope')
      return new Response(null, { status: 204 })
    }
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  let res: Response
  try {
    res = await handleRequest(makeReq({}, 'this-is-the-real-jwt-abc123'))
  } finally {
    globalThis.fetch = orig
  }

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.success, true)
  assertEquals(signOutScopeUsed, 'global')
  // A prova do fix: o header Authorization enviado ao /logout deve conter o
  // JWT real da requisição (não o UUID auth-uid-1 usado antes da correção).
  assertEquals(signOutJwtUsed, 'Bearer this-is-the-real-jwt-abc123')
})
