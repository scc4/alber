// E2E unit tests — admin-backfill-deposit-key (script de correção one-off)
// Roda com: deno test supabase/functions/admin-backfill-deposit-key/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('BACKFILL_ADMIN_SECRET', 'test-backfill-secret')

import { handleRequest } from './index.ts'
import { aesEncrypt, aesDecrypt } from '../_shared/crypto.ts'

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

function makeReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/admin-backfill-deposit-key', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'test-backfill-secret', ...headers },
    body:    JSON.stringify(body),
  })
}

Deno.test('sem x-admin-secret correto → 401', async () => {
  const res = await withMock([], undefined, () => handleRequest(makeReq({}, { 'x-admin-secret': 'wrong' })))
  assertEquals(res.status, 401)
})

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/admin-backfill-deposit-key', { method: 'GET', headers: { 'x-admin-secret': 'test-backfill-secret' } })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('adota chave EVP já existente na Asaas em vez de criar duplicata (caso do daniel)', async () => {
  const apiKeyEnc = await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key')
  const EXISTING_EVP = 'already-created-evp-key'

  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'daniel-id', asaas_api_key_enc: apiKeyEnc, asaas_deposit_key: null }] },
    { pattern: '/pix/addressKeys', method: 'GET', status: 200, body: { data: [{ key: EXISTING_EVP, type: 'EVP' }] } },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
  ]

  let createCalled = false
  let patchedKeyEnc: string | null = null
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'POST' && url.includes('/pix/addressKeys')) createCalled = true
    if (method === 'PATCH' && url.includes('/rest/v1/users')) patchedKeyEnc = (body as { asaas_deposit_key: string }).asaas_deposit_key
  }, () => handleRequest(makeReq({ dry_run: false })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.adopted_existing, 1)
  assertEquals(data.created_new, 0)
  assertEquals(createCalled, false) // não deve criar uma segunda chave

  const decrypted = await aesDecrypt(patchedKeyEnc!, 'test-encryption-key')
  assertEquals(decrypted, EXISTING_EVP)
})

Deno.test('sem chave EVP existente na Asaas — cria uma nova', async () => {
  const apiKeyEnc = await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key')
  const NEW_EVP = 'brand-new-evp-key'

  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', asaas_api_key_enc: apiKeyEnc, asaas_deposit_key: null }] },
    { pattern: '/pix/addressKeys', method: 'GET', status: 200, body: { data: [] } },
    { pattern: '/pix/addressKeys', method: 'POST', status: 200, body: { key: NEW_EVP, type: 'EVP' } },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
  ]

  const res  = await withMock(routes, undefined, () => handleRequest(makeReq({ dry_run: false })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.created_new, 1)
  assertEquals(data.adopted_existing, 0)
})

Deno.test('dry_run:true não grava nada', async () => {
  const apiKeyEnc = await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key')
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', asaas_api_key_enc: apiKeyEnc, asaas_deposit_key: null }] },
    { pattern: '/pix/addressKeys', method: 'GET', status: 200, body: { data: [] } },
    { pattern: '/pix/addressKeys', method: 'POST', status: 200, body: { key: 'evp-x', type: 'EVP' } },
  ]

  let patchCalled = false
  const res = await withMock(routes, (url, method) => {
    if (method === 'PATCH') patchCalled = true
  }, () => handleRequest(makeReq({ dry_run: true })))

  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.dry_run, true)
  assertEquals(patchCalled, false)
})

Deno.test('nenhum usuário pendente → contadores zerados', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq({ dry_run: true })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.created_new, 0)
  assertEquals(data.adopted_existing, 0)
  assertEquals(data.failed, 0)
})
