// E2E unit tests — webhooks-asaas-kyc Edge Function
// Roda com: deno test supabase/functions/webhooks-asaas-kyc/index.test.ts --allow-env --allow-net
//
// Cobre a correção da mesma conflação de conceitos do bug do "daniel": ao
// aprovar o KYC, o auto-registro de chave Pix de RECEBIMENTO (EVP) deve ser
// gravado em asaas_deposit_key, nunca em pix_key (chave de SAQUE do usuário).

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('ASAAS_WEBHOOK_SECRET', 'test-webhook-secret')

import { handleRequest } from './index.ts'
import { aesEncrypt } from '../_shared/crypto.ts'

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
  return new Request('http://localhost/webhooks-asaas-kyc', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'asaas-access-token': token },
    body:    JSON.stringify(payload),
  })
}

const APPROVED_PAYLOAD = { event: 'ACCOUNT_STATUS_CHANGED', account: { id: 'asaas-acc-1', status: 'APPROVED' } }

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/webhooks-asaas-kyc', { method: 'GET' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('token inválido → 401', async () => {
  const res = await withMock([], undefined, () => handleRequest(makeReq(APPROVED_PAYLOAD, 'wrong-token')))
  assertEquals(res.status, 401)
})

Deno.test('JSON inválido → 400', async () => {
  const req = new Request('http://localhost/webhooks-asaas-kyc', {
    method: 'POST',
    headers: { 'asaas-access-token': 'test-webhook-secret' },
    body: '{bad',
  })
  const routes: MockRoute[] = [{ pattern: '/rest/v1/error_logs', method: 'POST', status: 201, body: {} }]
  const res = await withMock(routes, undefined, () => handleRequest(req))
  assertEquals(res.status, 400)
})

Deno.test('evento não tratado → 200 sem ação', async () => {
  const res = await withMock([], undefined, () => handleRequest(makeReq({ event: 'PAYMENT_RECEIVED' })))
  assertEquals(res.status, 200)
})

Deno.test('KYC aprovado sem asaas_deposit_key — cria EVP e grava em asaas_deposit_key, não em pix_key', async () => {
  const apiKeyEnc = await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key')
  const NEW_EVP_KEY = 'evp-kyc-created-key'

  const routes: MockRoute[] = [
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [{ id: 'u1', name: 'Fulano', kyc_status: 'pending', asaas_api_key_enc: apiKeyEnc, asaas_deposit_key: null }],
    },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
    { pattern: '/pix/addressKeys', method: 'POST', status: 200, body: { key: NEW_EVP_KEY, type: 'EVP' } },
    { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
  ]

  const patchBodies: Record<string, unknown>[] = []
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'PATCH' && url.includes('/rest/v1/users')) patchBodies.push(body as Record<string, unknown>)
  }, () => handleRequest(makeReq(APPROVED_PAYLOAD)))

  assertEquals(res.status, 200)

  // Uma das chamadas PATCH deve gravar asaas_deposit_key; nenhuma deve tocar pix_key
  const depositKeyPatch = patchBodies.find(b => 'asaas_deposit_key' in b)
  assertEquals(depositKeyPatch !== undefined, true)
  assertEquals(patchBodies.some(b => 'pix_key' in b), false)
})

Deno.test('KYC aprovado com asaas_deposit_key já existente — não chama createPixAddressKey de novo', async () => {
  const apiKeyEnc    = await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key')
  const depositKeyEnc = await aesEncrypt('already-there', 'test-encryption-key')

  const routes: MockRoute[] = [
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [{ id: 'u1', name: 'Fulano', kyc_status: 'pending', asaas_api_key_enc: apiKeyEnc, asaas_deposit_key: depositKeyEnc }],
    },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
    { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
  ]

  let addressKeysCalled = false
  const res = await withMock(routes, (url) => {
    if (url.includes('/pix/addressKeys')) addressKeysCalled = true
  }, () => handleRequest(makeReq(APPROVED_PAYLOAD)))

  assertEquals(res.status, 200)
  assertEquals(addressKeysCalled, false)
})

Deno.test('KYC rejeitado — não tenta criar chave de recebimento', async () => {
  const apiKeyEnc = await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key')
  const routes: MockRoute[] = [
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [{ id: 'u1', name: 'Fulano', kyc_status: 'pending', asaas_api_key_enc: apiKeyEnc, asaas_deposit_key: null }],
    },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
    { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
  ]

  let addressKeysCalled = false
  const res = await withMock(routes, (url) => {
    if (url.includes('/pix/addressKeys')) addressKeysCalled = true
  }, () => handleRequest(makeReq({ event: 'ACCOUNT_STATUS_CHANGED', account: { id: 'asaas-acc-1', status: 'REJECTED' } })))

  assertEquals(res.status, 200)
  assertEquals(addressKeysCalled, false)
})

Deno.test('idempotência — kyc_status já é o novo status → ignora sem tocar no banco', async () => {
  const routes: MockRoute[] = [
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [{ id: 'u1', name: 'Fulano', kyc_status: 'approved', asaas_api_key_enc: null, asaas_deposit_key: null }],
    },
  ]
  const res = await withMock(routes, undefined, () => handleRequest(makeReq(APPROVED_PAYLOAD)))
  assertEquals(res.status, 200)
})
