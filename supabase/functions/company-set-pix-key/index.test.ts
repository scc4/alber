// E2E unit tests — company-set-pix-key Edge Function
// Roda com: deno test supabase/functions/company-set-pix-key/index.test.ts --allow-env --allow-net
//
// Cobre a autenticação dupla (PIN + confirmação de segurança) adicionada ao
// endpoint — antes só validava JWT + owner_id, fora do padrão de
// specs/05_security.md §4 ("Cadastrar/trocar chave Pix"), mesmo padrão de
// perfil-update-pin/index.test.ts para o mock de auth.admin.getUserById.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')

import { handleRequest } from './index.ts'
import { bcryptHash, sha256hex } from '../_shared/crypto.ts'

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

const AUTH_UUID  = '11111111-1111-4111-8111-111111111111'
const AUTH_USER  = { id: AUTH_UUID, aud: 'authenticated' }
const CALLER     = { id: 'master-1', auth_id: AUTH_UUID }
const COMPANY_ID = 'company-1'
const PIN_HASH   = 'a'.repeat(64)
const SEC_HASH   = 'b'.repeat(64)
const VALID_CNPJ = '11222333000181' // dígito verificador válido conforme _shared/cnpj.ts

function makeReq(body: Record<string, unknown> = {}, token = 'valid-tok'): Request {
  return new Request('http://localhost/company-set-pix-key', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_id:           COMPANY_ID,
      type:                 'cnpj',
      cnpj:                 VALID_CNPJ,
      pin_hash:             PIN_HASH,
      security_answer_hash: SEC_HASH,
      ...body,
    }),
  })
}

function company(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID, owner_id: CALLER.id, cnpj: null, pix_key: null, asaas_api_key_enc: null,
    ...overrides,
  }
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/company-set-pix-key', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/company-set-pix-key', { method: 'POST', body: '{}' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('sem pin_hash/security_answer_hash → 400 MISSING_FIELDS', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ pin_hash: undefined, security_answer_hash: undefined })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'MISSING_FIELDS')
})

Deno.test('caller não é o master → 403 FORBIDDEN (antes de checar PIN)', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',      method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',     method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [company({ owner_id: 'other-user' })] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'FORBIDDEN')
})

Deno.test('empresa já tem chave Pix → 409 PIX_KEY_EXISTS (antes de checar PIN)', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',      method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',     method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies', method: 'GET', status: 200, body: [company({ pix_key: 'already-set' })] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 409)
  assertEquals(data.code, 'PIX_KEY_EXISTS')
})

Deno.test('PIN incorreto → 401 INVALID_CREDENTIALS e grava audit_logs company_pix_key_pin_failed', async () => {
  const wrongPinBcrypt = await bcryptHash('not-the-pin', 6)
  let auditEvent: string | null = null

  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',            method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',           method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies',       method: 'GET', status: 200, body: [company()] },
    { pattern: '/auth/v1/admin/users/',    method: 'GET', status: 200, body: { id: AUTH_UUID, app_metadata: { pin_bcrypt: wrongPinBcrypt } } },
  ]

  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/rest/v1/audit_logs') && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      auditEvent = JSON.parse(init!.body as string).event_type
      return new Response(JSON.stringify({}), { status: 201 })
    }
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
  assertEquals(data.code, 'INVALID_CREDENTIALS')
  assertEquals(data.message, 'PIN incorreto')
  assertEquals(auditEvent, 'company_pix_key_pin_failed')
})

Deno.test('resposta de segurança incorreta → 401 INVALID_CREDENTIALS e grava audit_logs company_pix_key_security_failed', async () => {
  const pinBcrypt = await bcryptHash(PIN_HASH, 6)
  const wrongSecBcrypt = await bcryptHash('not-the-answer', 6)
  let auditEvent: string | null = null

  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',             method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',            method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies',        method: 'GET', status: 200, body: [company()] },
    { pattern: '/auth/v1/admin/users/',     method: 'GET', status: 200, body: { id: AUTH_UUID, app_metadata: { pin_bcrypt: pinBcrypt } } },
    { pattern: '/rest/v1/security_questions', method: 'GET', status: 200, body: [{ answer_hash: wrongSecBcrypt }] },
  ]

  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/rest/v1/audit_logs') && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      auditEvent = JSON.parse(init!.body as string).event_type
      return new Response(JSON.stringify({}), { status: 201 })
    }
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
  assertEquals(data.code, 'INVALID_CREDENTIALS')
  assertEquals(data.message, 'Resposta de segurança incorreta')
  assertEquals(auditEvent, 'company_pix_key_security_failed')
})

Deno.test('PIN e segurança corretos, CNPJ não bate com o cadastrado → 422 CNPJ_MISMATCH', async () => {
  const pinBcrypt = await bcryptHash(PIN_HASH, 6)
  const secBcrypt = await bcryptHash(SEC_HASH, 6)
  const differentCnpjHash = await sha256hex('00000000000191') // dígito verificador válido, mas outro CNPJ

  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',               method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',              method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies',          method: 'GET', status: 200, body: [company({ cnpj: differentCnpjHash })] },
    { pattern: '/auth/v1/admin/users/',       method: 'GET', status: 200, body: { id: AUTH_UUID, app_metadata: { pin_bcrypt: pinBcrypt } } },
    { pattern: '/rest/v1/security_questions', method: 'GET', status: 200, body: [{ answer_hash: secBcrypt }] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'CNPJ_MISMATCH')
})

Deno.test('fluxo completo com sucesso: salva chave CNPJ e grava audit_logs company_pix_key_changed', async () => {
  const pinBcrypt = await bcryptHash(PIN_HASH, 6)
  const secBcrypt = await bcryptHash(SEC_HASH, 6)
  const matchingCnpjHash = await sha256hex(VALID_CNPJ)
  let auditEvent: string | null = null
  let companyUpdated = false

  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',               method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users',              method: 'GET', status: 200, body: [CALLER] },
    { pattern: '/rest/v1/companies',          method: 'GET', status: 200, body: [company({ cnpj: matchingCnpjHash })] },
    { pattern: '/auth/v1/admin/users/',       method: 'GET', status: 200, body: { id: AUTH_UUID, app_metadata: { pin_bcrypt: pinBcrypt } } },
    { pattern: '/rest/v1/security_questions', method: 'GET', status: 200, body: [{ answer_hash: secBcrypt }] },
  ]

  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/rest/v1/companies') && method === 'PATCH') {
      companyUpdated = true
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.includes('/rest/v1/audit_logs') && method === 'POST') {
      auditEvent = JSON.parse(init!.body as string).event_type
      return new Response(JSON.stringify({}), { status: 201 })
    }
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  let res: Response
  try {
    res = await handleRequest(makeReq())
  } finally {
    globalThis.fetch = orig
  }

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.pix_key_type, 'cnpj')
  assertEquals(companyUpdated, true)
  assertEquals(auditEvent, 'company_pix_key_changed')
})
