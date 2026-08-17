// E2E unit tests — auth-company-lookup Edge Function
// Roda com: deno test supabase/functions/auth-company-lookup/index.test.ts --allow-env --allow-net
//
// Primeiro passo do login "como empresa" (CNPJ ou @handle de empresa) — só
// resolve QUEM (master/operadores mascarados), nunca autentica. Cobre:
// identificador vazio/inválido → not_company; rate limit; empresa achada por
// @handle e por CNPJ retorna master + operadores ativos com nome mascarado
// (nunca em texto puro); empresa sem ninguém elegível → not_company.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')

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

function makeReq(identifier: string): Request {
  return new Request('http://localhost/auth-company-lookup', {
    method: 'POST',
    body:   JSON.stringify({ identifier }),
  })
}

const RATE_OK: MockRoute = { pattern: '/rest/v1/audit_logs', method: 'GET', status: 200, body: [] }
const AUDIT_INSERT: MockRoute = { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} }

// CNPJ numérico válido (dígitos verificadores corretos) usado nos testes.
const VALID_CNPJ = '11222333000181'

const COMPANY_ROW = [{
  id: 'comp-1', company_name: 'Empresa Teste LTDA', trading_name: 'Empresa Teste', owner_id: 'master-1',
}]

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/auth-company-lookup', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('identifier vazio → not_company', async () => {
  const res  = await withMock([], () => handleRequest(makeReq('')))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.kind, 'not_company')
})

Deno.test('CNPJ com formato inválido → not_company', async () => {
  const routes: MockRoute[] = [RATE_OK, AUDIT_INSERT]
  const res  = await withMock(routes, () => handleRequest(makeReq('123')))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.kind, 'not_company')
})

Deno.test('rate limit (10 tentativas em 15min) → 429', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': '0-0/10' } })
    }
    return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    const res = await handleRequest(makeReq(VALID_CNPJ))
    assertEquals(res.status, 429)
  } finally {
    globalThis.fetch = orig
  }
})

Deno.test('@handle sem empresa correspondente → not_company', async () => {
  const routes: MockRoute[] = [
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq('@naoexiste')))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.kind, 'not_company')
})

Deno.test('@handle de empresa existente → company com master + operadores mascarados', async () => {
  const routes: MockRoute[] = [
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: COMPANY_ROW },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'master-1', name: 'Fernando Silva' }] },
    { pattern: '/rest/v1/company_operators', method: 'GET', status: 200, body: [{ users: { id: 'op-1', name: 'Ana Costa' } }] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq('@empresateste')))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.kind, 'company')
  assertEquals(data.company_id, 'comp-1')
  assertEquals(data.company_name, 'Empresa Teste')
  assertEquals(data.operators.length, 2)

  const master = data.operators.find((o: { role: string }) => o.role === 'master')
  const operator = data.operators.find((o: { role: string }) => o.role === 'operator')
  assertEquals(master.ref, 'master-1')
  assertEquals(operator.ref, 'op-1')

  // Nunca vaza o nome em texto puro
  const allNames = JSON.stringify(data)
  assertEquals(allNames.includes('Fernando Silva'), false)
  assertEquals(allNames.includes('Ana Costa'), false)
})

Deno.test('CNPJ válido de empresa existente → company', async () => {
  const routes: MockRoute[] = [
    RATE_OK, AUDIT_INSERT,
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: COMPANY_ROW },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'master-1', name: 'Fernando Silva' }] },
    { pattern: '/rest/v1/company_operators', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq(VALID_CNPJ)))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.kind, 'company')
  assertEquals(data.operators.length, 1)
  assertEquals(data.operators[0].role, 'master')
})
