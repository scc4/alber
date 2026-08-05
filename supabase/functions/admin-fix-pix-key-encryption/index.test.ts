// E2E unit tests — admin-fix-pix-key-encryption (script de correção one-off)
// Roda com: deno test supabase/functions/admin-fix-pix-key-encryption/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')   // secret ERRADO usado pelo bug antigo
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')    // secret CORRETO usado pelo resto do sistema
Deno.env.set('PIX_FIX_ADMIN_SECRET', 'test-admin-secret')

import { handleRequest } from './index.ts'
import { aesEncrypt, aesDecrypt } from '../_shared/crypto.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }

function mockFetch(routes: MockRoute[], onPatch?: (url: string, body: unknown) => void) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()

    if (method === 'PATCH' && onPatch) {
      onPatch(url, init?.body ? JSON.parse(init.body as string) : null)
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

function withMock<T>(routes: MockRoute[], onPatch: ((url: string, body: unknown) => void) | undefined, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = mockFetch(routes, onPatch) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

function makeReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/admin-fix-pix-key-encryption', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'test-admin-secret', ...headers },
    body:    JSON.stringify(body),
  })
}

Deno.test('sem x-admin-secret correto → 401', async () => {
  const req = makeReq({}, { 'x-admin-secret': 'wrong' })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/admin-fix-pix-key-encryption', {
    method: 'GET',
    headers: { 'x-admin-secret': 'test-admin-secret' },
  })
  const res = await withMock([], undefined, () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('classifica corretamente: já correto / corrigível / corrompido — e dry_run não grava nada', async () => {
  const alreadyOkEnc = await aesEncrypt('11144477735', 'test-encryption-key')      // já com o secret certo
  const fixableEnc    = await aesEncrypt('55566677788', 'test-asaas-parent-key')   // com o secret errado do bug
  const corruptedEnc  = 'not-a-valid-base64-cipher!!'                              // nenhum secret decripta

  const routes: MockRoute[] = [
    {
      pattern: '/rest/v1/users', method: 'GET', status: 200,
      body: [
        { id: 'user-ok',        pix_key: alreadyOkEnc },
        { id: 'user-fixable',   pix_key: fixableEnc },
        { id: 'user-corrupted', pix_key: corruptedEnc },
      ],
    },
    { pattern: '/rest/v1/error_logs', method: 'POST', status: 201, body: {} },
  ]

  let patchCalled = false
  const res = await withMock(routes, () => { patchCalled = true }, () =>
    handleRequest(makeReq({ dry_run: true }))
  )
  const data = await res.json()

  assertEquals(res.status, 200)
  assertEquals(data.dry_run, true)
  assertEquals(data.already_ok, 1)
  assertEquals(data.fixed, 1)
  assertEquals(data.unreadable, 1)
  assertEquals(patchCalled, false) // dry_run não deve gravar nada
})

Deno.test('dry_run:false re-criptografa o registro afetado com ENCRYPTION_KEY, preservando o valor original', async () => {
  const fixableEnc = await aesEncrypt('99988877766', 'test-asaas-parent-key')

  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [{ id: 'user-fixable', pix_key: fixableEnc }] },
    { pattern: '/rest/v1/users', method: 'PATCH', status: 200, body: [] },
  ]

  let patchedBody: { pix_key?: string } | null = null
  const res = await withMock(routes, (_url, body) => { patchedBody = body as { pix_key?: string } }, () =>
    handleRequest(makeReq({ dry_run: false }))
  )
  const data = await res.json()

  assertEquals(res.status, 200)
  assertEquals(data.fixed, 1)
  assertEquals(data.already_ok, 0)
  assertEquals(data.unreadable, 0)

  const reEncrypted = patchedBody!.pix_key!
  const decrypted = await aesDecrypt(reEncrypted, 'test-encryption-key')
  assertEquals(decrypted, '99988877766') // valor original preservado, só o secret mudou
})

Deno.test('nenhum usuário com pix_key → contadores zerados', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, undefined, () => handleRequest(makeReq({ dry_run: true })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.already_ok, 0)
  assertEquals(data.fixed, 0)
  assertEquals(data.unreadable, 0)
})
