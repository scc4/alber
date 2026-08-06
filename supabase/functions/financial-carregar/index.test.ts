// E2E unit tests — financial-carregar Edge Function
// Roda com: deno test supabase/functions/financial-carregar/index.test.ts --allow-env --allow-net
//
// Cobre o bug reportado pelo usuário "daniel": o QR code do Pix não era gerado
// ao carregar. Causa raiz confirmada em produção: o backend usava pix_key (a
// chave de SAQUE escolhida pelo usuário, usada só em descarregar) como se fosse
// a chave de RECEBIMENTO da subconta — a Asaas rejeita com "Chave Pix não
// encontrada" porque pix_key nunca é registrada como chave de recebimento.
// A chave de recebimento precisa ser uma EVP própria da subconta, registrada
// via POST /pix/addressKeys e guardada num campo separado (asaas_deposit_key).

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')

import { handleRequest } from './index.ts'
import { aesEncrypt } from '../_shared/crypto.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }

function mockFetch(routes: MockRoute[], onRequest?: (url: string, method: string, body: unknown) => void) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET')).toUpperCase()

    if (onRequest) {
      const parsedBody = init?.body ? JSON.parse(init.body as string) : null
      onRequest(url, method, parsedBody)
    }

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

const AUTH_USER = { id: 'auth-uid-1', aud: 'authenticated' }
const DEPOSIT_KEY_RAW = 'evp-deposit-key-abc' // chave de RECEBIMENTO — distinta da pix_key de saque

const QR_RESPONSE = { id: 'qr-static-1', encodedImage: 'base64img', payload: 'payload-copia-cola' }

function makeReq(body: Record<string, unknown> = { amount_albers: 50 }): Request {
  return new Request('http://localhost/financial-carregar', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer valid-tok', 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/financial-carregar', { method: 'GET' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/financial-carregar', { method: 'POST', body: '{}' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('valor inválido → 400', async () => {
  const routes: MockRoute[] = [{ pattern: '/auth/v1/user', method: 'GET', status: 200, body: AUTH_USER }]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq({ amount_albers: 0 })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_AMOUNT')
})

Deno.test('usuário não encontrado → 404', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'USER_NOT_FOUND')
})

Deno.test('KYC não aprovado → 403', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'u1', kyc_status: 'pending', account_status: 'evaluation' }] },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 403)
  assertEquals(data.code, 'KYC_REQUIRED')
})

Deno.test('limite do período de avaliação atingido → 422', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [{ id: 'u1', kyc_status: 'approved', account_status: 'evaluation', created_at: '2026-01-01T00:00:00Z' }],
    },
    { pattern: '/rest/v1/transactions', method: 'GET', status: 200, body: [{ amount_brl: '1980' }] },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq({ amount_albers: 50 })))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'EVALUATION_LIMIT')
})

Deno.test('sem asaas_api_key_enc → 503 ACCOUNT_NOT_CONFIGURED', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [{ id: 'u1', kyc_status: 'approved', account_status: 'active', asaas_api_key_enc: null }],
    },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 503)
  assertEquals(data.code, 'ACCOUNT_NOT_CONFIGURED')
})

Deno.test('com asaas_deposit_key já registrada — usa ela no QR, nunca a pix_key de saque', async () => {
  const apiKeyEnc      = await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key')
  const depositKeyEnc  = await aesEncrypt(DEPOSIT_KEY_RAW, 'test-encryption-key')

  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [{
        id: 'u1', kyc_status: 'approved', account_status: 'active',
        asaas_api_key_enc: apiKeyEnc, asaas_deposit_key: depositKeyEnc,
        pix_key: 'should-not-be-selected-or-used', // se o backend voltasse a usar pix_key, isso vazaria no addressKey
      }],
    },
    { pattern: '/pix/qrCodes/static',   method: 'POST', status: 200, body: QR_RESPONSE },
    { pattern: '/rest/v1/transactions', method: 'POST', status: 201, body: { id: 'tx-1' } },
    { pattern: '/rest/v1/audit_logs',   method: 'POST', status: 201, body: {} },
    { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
  ]

  let capturedQrBody: { addressKey?: string } | null = null
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'POST' && url.includes('/pix/qrCodes/static')) capturedQrBody = body as { addressKey?: string }
  }, () => handleRequest(makeReq()))

  const data = await res.json()
  assertEquals(res.status, 201)
  assertEquals(data.payment_id, 'tx-1')
  assertEquals(capturedQrBody!.addressKey, DEPOSIT_KEY_RAW)
  assertNotEquals(capturedQrBody!.addressKey, 'should-not-be-selected-or-used')
})

Deno.test('sem asaas_deposit_key — cria EVP na Asaas, grava no campo certo e usa no QR (fallback)', async () => {
  const apiKeyEnc   = await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key')
  const NEW_EVP_KEY = 'evp-created-now-xyz'

  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [{ id: 'u1', kyc_status: 'approved', account_status: 'active', asaas_api_key_enc: apiKeyEnc, asaas_deposit_key: null }],
    },
    { pattern: '/pix/addressKeys',      method: 'POST',  status: 200, body: { key: NEW_EVP_KEY, type: 'EVP' } },
    { pattern: '/pix/qrCodes/static',   method: 'POST',  status: 200, body: QR_RESPONSE },
    { pattern: '/rest/v1/users',        method: 'PATCH', status: 200, body: [] },
    { pattern: '/rest/v1/transactions', method: 'POST',  status: 201, body: { id: 'tx-2' } },
    { pattern: '/rest/v1/audit_logs',   method: 'POST',  status: 201, body: {} },
    { pattern: '/functions/v1/push-send', method: 'POST', status: 200, body: {} },
  ]

  let capturedQrBody:     { addressKey?: string } | null = null
  let capturedUpdateBody: { asaas_deposit_key?: string; pix_key?: string } | null = null
  const res = await withMock(routes, (url, method, body) => {
    if (method === 'POST' && url.includes('/pix/qrCodes/static')) capturedQrBody = body as { addressKey?: string }
    if (method === 'PATCH' && url.includes('/rest/v1/users'))     capturedUpdateBody = body as { asaas_deposit_key?: string; pix_key?: string }
  }, () => handleRequest(makeReq()))

  const data = await res.json()
  assertEquals(res.status, 201)
  assertEquals(data.payment_id, 'tx-2')
  assertEquals(capturedQrBody!.addressKey, NEW_EVP_KEY)
  assertEquals(capturedUpdateBody!.asaas_deposit_key !== undefined, true)
  assertEquals(capturedUpdateBody!.pix_key, undefined) // nunca deve escrever em pix_key
})
