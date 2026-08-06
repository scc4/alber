// E2E unit tests — conta-excluir Edge Function
// Roda com: deno test supabase/functions/conta-excluir/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')

import { handleRequest } from './index.ts'
import { aesEncrypt, bcryptHash } from '../_shared/crypto.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }

function mockFetch(routes: MockRoute[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET')).toUpperCase()
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
const PIN_HASH   = 'a'.repeat(64)
const SEC_HASH   = 'b'.repeat(64)

function makeReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/conta-excluir', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer valid-tok', 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function userRow(overrides: Record<string, unknown> = {}) {
  return [{ id: 'db-user-1', auth_id: AUTH_UUID, asaas_api_key_enc: null, deleted_at: null, ...overrides }]
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/conta-excluir', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/conta-excluir', { method: 'POST', body: '{}' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('conta já excluída → 409', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow({ deleted_at: '2026-01-01T00:00:00Z' }) },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ action: 'status' })))
  const data = await res.json()
  assertEquals(res.status, 409)
  assertEquals(data.code, 'ALREADY_DELETED')
})

Deno.test('status — sem asaas key (sem saldo a checar), sem splits/lounges → eligible:true', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/rest/v1/splits', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/spaces', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/split_participants', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ action: 'status' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.eligible, true)
  assertEquals(data.blocks.positive_balance, false)
})

Deno.test('status — dono de split aberto → eligible:false, owns_active_split:true', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/rest/v1/splits', method: 'GET', status: 200, body: [{ id: 'split-1' }] },
    { pattern: '/rest/v1/spaces', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/split_participants', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ action: 'status' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.eligible, false)
  assertEquals(data.blocks.owns_active_split, true)
})

Deno.test('status — saldo positivo na Asaas → eligible:false, positive_balance:true', async () => {
  const apiKeyEnc = await aesEncrypt('sub-api-key', 'test-asaas-parent-key')
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow({ asaas_api_key_enc: apiKeyEnc }) },
    { pattern: '/finance/balance', method: 'GET', status: 200, body: { balance: 42.5 } },
    { pattern: '/rest/v1/splits', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/spaces', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/split_participants', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ action: 'status' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.eligible, false)
  assertEquals(data.blocks.positive_balance, true)
  assertEquals(data.balance_brl, 42.5)
})

Deno.test('action inválido → 400', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
  ]
  const res = await withMock(routes, () => handleRequest(makeReq({ action: 'bogus' })))
  assertEquals(res.status, 400)
})

Deno.test('confirm — revalida elegibilidade no servidor, bloqueia mesmo sem checar PIN', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/rest/v1/splits', method: 'GET', status: 200, body: [{ id: 'split-1' }] }, // dono de split aberto
    { pattern: '/rest/v1/spaces', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/split_participants', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () =>
    handleRequest(makeReq({ action: 'confirm', pin_hash: PIN_HASH, security_answer_hash: SEC_HASH, sms_code: '123456' }))
  )
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'NOT_ELIGIBLE')
})

Deno.test('confirm — PIN incorreto → 401, não avança', async () => {
  const pinBcrypt = await bcryptHash('correct-pin-hash')
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/rest/v1/splits', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/spaces', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/split_participants', method: 'GET', status: 200, body: [] },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: AUTH_UUID, app_metadata: { pin_bcrypt: pinBcrypt } } },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
  ]
  const res  = await withMock(routes, () =>
    handleRequest(makeReq({ action: 'confirm', pin_hash: 'wrong-pin-hash', security_answer_hash: SEC_HASH, sms_code: '123456' }))
  )
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'INVALID_CREDENTIALS')
})

Deno.test('confirm — fluxo completo com sucesso: anonimiza, marca deleted_at, derruba sessões', async () => {
  const pinBcrypt = await bcryptHash(PIN_HASH)
  const secBcrypt = await bcryptHash(SEC_HASH, 6)
  const nowIso = new Date(Date.now() + 5 * 60_000).toISOString()

  let patchedUserBody: Record<string, unknown> | null = null
  let signOutCalled = false

  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/rest/v1/splits', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/spaces', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/split_participants', method: 'GET', status: 200, body: [] },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: AUTH_UUID, app_metadata: { pin_bcrypt: pinBcrypt } } },
    { pattern: '/rest/v1/security_questions', method: 'GET', status: 200, body: [{ answer_hash: secBcrypt }] },
    { pattern: '/rest/v1/sms_codes', method: 'GET', status: 200, body: [{ id: 'sms-1', code: '123456', expires_at: nowIso, used_at: null }] },
    { pattern: '/rest/v1/sms_codes', method: 'PATCH', status: 200, body: [] },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
  ]

  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'PATCH' && url.includes('/rest/v1/users')) {
      patchedUserBody = JSON.parse(init!.body as string)
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (method === 'POST' && url.includes('/auth/v1/logout')) {
      signOutCalled = true
      return new Response(null, { status: 204 })
    }
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  let res: Response
  try {
    res = await handleRequest(makeReq({ action: 'confirm', pin_hash: PIN_HASH, security_answer_hash: SEC_HASH, sms_code: '123456' }))
  } finally {
    globalThis.fetch = orig
  }

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.success, true)
  assertEquals(patchedUserBody!.name, 'Usuário removido')
  assertEquals(patchedUserBody!.handle, 'removido-db-user-')
  assertEquals(typeof patchedUserBody!.email, 'string')
  assertEquals(typeof patchedUserBody!.deleted_at, 'string')
  assertEquals(signOutCalled, true) // sessão derrubada via signOut(jwt, 'global') com o token real da requisição
})
