// E2E unit tests — auth-login Edge Function
// Roda com: deno test supabase/functions/auth-login/index.test.ts --allow-env --allow-net
//
// Cobre principalmente o novo gate de conta excluída (deleted_at), que impede
// login mesmo com PIN/pergunta de segurança corretos — parte do fluxo de
// exclusão de conta (soft delete). Não retesta toda a lógica pré-existente de
// PIN em pares/legado (fora do escopo desta mudança).

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'

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

const VALID_CPF = '52998224725' // válido conforme _shared/cpf.ts

function makeReq(body: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/auth-login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      cpf:                   VALID_CPF,
      pin_hash:               'a'.repeat(64),
      security_answer_hash:   'b'.repeat(64),
      ...body,
    }),
  })
}

function userRow(overrides: Record<string, unknown> = {}) {
  return [{
    id: 'db-user-1', auth_id: '11111111-1111-4111-8111-111111111111',
    name: 'Fulano', email: 'fulano@teste.com', handle: 'fulano',
    kyc_status: 'approved', account_status: 'active', deleted_at: null,
    ...overrides,
  }]
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/auth-login', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('campos obrigatórios ausentes → 400', async () => {
  const req = new Request('http://localhost/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cpf: VALID_CPF }),
  })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 400)
})

Deno.test('identificador inválido (nem CPF nem @handle) → 401 INVALID_CREDENTIALS', async () => {
  const res  = await withMock([], () => handleRequest(makeReq({ cpf: '123' })))
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'INVALID_CREDENTIALS')
})

Deno.test('usuário não encontrado → 401 INVALID_CREDENTIALS (não revela existência)', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'INVALID_CREDENTIALS')
})

Deno.test('conta excluída (deleted_at preenchido) → 401 ACCOUNT_DELETED, nunca chega a checar PIN', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow({ deleted_at: '2026-01-01T00:00:00Z' }) },
  ]
  let adminUsersCalled = false
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/auth/v1/admin/users/')) adminUsersCalled = true
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  let res: Response
  try {
    res = await handleRequest(makeReq())
  } finally {
    globalThis.fetch = orig
  }
  const data = await res.json()
  assertEquals(res.status, 401)
  assertEquals(data.code, 'ACCOUNT_DELETED')
  assertEquals(adminUsersCalled, false) // não deveria nem tentar verificar o PIN
})

Deno.test('conta ativa (deleted_at null) — passa do gate de exclusão, segue para checar PIN', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: '1', app_metadata: {} } },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  // Sem pin_bcrypt configurado no mock → cai em INVALID_CREDENTIALS, mas
  // o importante aqui é que NÃO é ACCOUNT_DELETED — passou do gate certo.
  assertEquals(res.status, 401)
  assertEquals(data.code, 'INVALID_CREDENTIALS')
})

Deno.test('muitas tentativas recentes → 429 TOO_MANY_ATTEMPTS', async () => {
  // failedAttempts usa select(..., { count: 'exact', head: true }) — o count
  // vem do header Content-Range da resposta, não do body (postgrest-js).
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('/rest/v1/audit_logs')) {
      return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }
    // head:true count query — pode chegar como GET ou HEAD dependendo da versão do postgrest-js
    if (url.includes('/rest/v1/audit_logs')) {
      return new Response(null, { status: 200, headers: { 'content-range': '0-2/3' } })
    }
    if (url.includes('/rest/v1/users')) {
      return new Response(JSON.stringify(userRow()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }) as typeof fetch

  let res: Response
  try {
    res = await handleRequest(makeReq())
  } finally {
    globalThis.fetch = orig
  }
  const data = await res.json()
  assertEquals(res.status, 429)
  assertEquals(data.code, 'TOO_MANY_ATTEMPTS')
})
