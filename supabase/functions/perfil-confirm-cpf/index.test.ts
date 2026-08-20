// E2E unit tests — perfil-confirm-cpf Edge Function
// Roda com: deno test supabase/functions/perfil-confirm-cpf/index.test.ts --allow-env --allow-net
//
// Contas cadastradas antes de users.cpf_masked existir não têm esse campo
// salvo (só o hash é guardado) — este endpoint deixa o usuário confirmar o
// CPF; se o hash bater, persiste a versão mascarada.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'
import { sha256hex } from '../_shared/crypto.ts'

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
const VALID_CPF = '52998224725' // válido conforme utils/cpf.ts — dígito verificador correto

const RATE_OK      = { pattern: '/rest/v1/audit_logs', method: 'GET',  status: 200, body: [] }
const AUDIT_INSERT = { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} }

function makeReq(cpf: string, token = 'valid-tok'): Request {
  return new Request('http://localhost/perfil-confirm-cpf', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ cpf }),
  })
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/perfil-confirm-cpf', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/perfil-confirm-cpf', { method: 'POST', body: '{}' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('CPF com formato inválido → 422 CPF_INVALID', async () => {
  const routes: MockRoute[] = [{ pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER }]
  const res  = await withMock(routes, () => handleRequest(makeReq('11111111111')))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'CPF_INVALID')
})

Deno.test('usuário não encontrado → 404 USER_NOT_FOUND', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq(VALID_CPF)))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'USER_NOT_FOUND')
})

Deno.test('CPF não confere com o hash salvo → 422 CPF_MISMATCH', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', cpf: 'hash-de-outro-cpf' }] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq(VALID_CPF)))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'CPF_MISMATCH')
})

Deno.test('CPF confere → 200 com cpf_masked no formato ***.***.*XX-XX', async () => {
  const cpfHash = await sha256hex(VALID_CPF)
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET',   status: 200, body: AUTH_USER },
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/users', method: 'GET',   status: 200, body: [{ id: 'u1', cpf: cpfHash }] },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq(VALID_CPF)))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.cpf_masked, '***.***.*47-25')
})

Deno.test('rate limit (10 tentativas em 15min) → 429', async () => {
  const routes: MockRoute[] = [{ pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER }]
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': '0-0/10' } })
    }
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  try {
    const res = await handleRequest(makeReq(VALID_CPF))
    assertEquals(res.status, 429)
  } finally {
    globalThis.fetch = orig
  }
})
