// E2E unit tests — company-create Edge Function
// Roda com: deno test supabase/functions/company-create/index.test.ts --allow-env --allow-net
//
// Melhoria 1: quem já tem conta pessoal (autenticado) abre uma empresa sem
// passar pelo cadastro pessoal de novo. Reaproveita createCompanyForOwner
// (_shared/company.ts) — cobre também o campo novo pix_key_type (chave de
// saque própria da empresa, cnpj|random, nunca cpf/phone/email).

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')

import { handleRequest } from './index.ts'

type Handler = (url: string, method: string, body: unknown) => Response | null

function withMock<T>(handler: Handler, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body   = init?.body ? JSON.parse(init.body as string) : null
    const res = handler(url, method, body)
    if (res) return res
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const AUTH_USER    = { id: 'auth-uid-1', aud: 'authenticated' }
const CALLER       = { id: 'caller-1', deleted_at: null }
const OWNER        = { id: 'caller-1', email: 'dono@teste.com', phone: '11988887777' }
const ASAAS_ACCOUNT_NO_KEY = { id: 'asaas-acc-1', apiKey: null, walletId: 'wallet-1' }
const NEW_COMPANY  = { id: 'company-1' }

const VALID_COMPANY = {
  cnpj:         '11222333000181', // dígito verificador válido conforme utils/cnpj.ts
  handle:       'minhaempresa',
  company_name: 'Minha Empresa LTDA',
  company_type: 'LIMITED',
  income_value: 5000,
  address: { street: 'Rua X', number: '100', neighborhood: 'Centro', zip_code: '01000000' },
}

function makeReq(company: Record<string, unknown> = VALID_COMPANY, token = 'valid-tok'): Request {
  return new Request('http://localhost/company-create', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ company }),
  })
}

// Handler base compartilhado pelos testes de sucesso — resolve as 3 queries
// distintas em /rest/v1/users (caller por auth_id, handle check, owner por id)
// e as 2 em /rest/v1/companies (handle check, cnpj dup check) pela query string.
function baseHandler(overrides: { handleUser?: unknown; handleCompany?: unknown; cnpjCompany?: unknown } = {}): Handler {
  return (url, method) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify(AUTH_USER), { status: 200 })
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '0-0/0' } })
    if (url.includes('/rest/v1/audit_logs') && method === 'POST') return new Response('{}', { status: 201 })
    if (url.includes('/rest/v1/users') && url.includes('auth_id=eq.')) return new Response(JSON.stringify(CALLER), { status: 200 })
    if (url.includes('/rest/v1/users') && url.includes('handle=eq.')) return new Response(JSON.stringify(overrides.handleUser === undefined ? [] : overrides.handleUser), { status: 200 })
    if (url.includes('/rest/v1/users') && url.includes('id=eq.')) return new Response(JSON.stringify(OWNER), { status: 200 })
    if (url.includes('/rest/v1/companies') && url.includes('handle=eq.')) return new Response(JSON.stringify(overrides.handleCompany === undefined ? [] : overrides.handleCompany), { status: 200 })
    if (url.includes('/rest/v1/companies') && url.includes('cnpj=eq.')) return new Response(JSON.stringify(overrides.cnpjCompany === undefined ? [] : overrides.cnpjCompany), { status: 200 })
    if (url.includes('sandbox.asaas.com/api/v3/accounts') && method === 'POST') return new Response(JSON.stringify(ASAAS_ACCOUNT_NO_KEY), { status: 200 })
    if (url.includes('/rest/v1/companies') && method === 'POST') return new Response(JSON.stringify(NEW_COMPANY), { status: 201 })
    return null
  }
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/company-create', { method: 'GET' })
  const res = await withMock(baseHandler(), () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/company-create', { method: 'POST', body: '{}' })
  const res = await withMock(baseHandler(), () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('sem company no body → 400 MISSING_FIELDS', async () => {
  const res = await withMock(baseHandler(), () =>
    handleRequest(new Request('http://localhost/company-create', {
      method: 'POST', headers: { Authorization: 'Bearer tok' }, body: '{}',
    })))
  assertEquals(res.status, 400)
})

Deno.test('CNPJ já cadastrado por outra empresa → 409 CNPJ_DUPLICATE', async () => {
  const handler = baseHandler({ cnpjCompany: [{ id: 'other-co', kyc_status: 'approved' }] })
  const res  = await withMock(handler, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 409)
  assertEquals(data.code, 'CNPJ_DUPLICATE')
})

Deno.test('pix_key_type inválido → 400 INVALID_PIX_KEY_TYPE', async () => {
  const res  = await withMock(baseHandler(), () =>
    handleRequest(makeReq({ ...VALID_COMPANY, pix_key_type: 'email' })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_PIX_KEY_TYPE')
})

// Regressão: achado durante o teste em produção — a Asaas exige e-mail único
// por subconta dentro da mesma conta pai. Reusar o e-mail pessoal do dono na
// subconta da empresa colide SEMPRE que o dono também tem carteira pessoal
// (o caso comum), derrubando toda criação de empresa com
// "O email <x> já está em uso". Nenhuma empresa jamais foi criada com sucesso
// neste projeto até esse bug ser corrigido (confirmado via error_logs reais).
Deno.test('e-mail enviado à Asaas para a subconta da empresa é baseado no CNPJ, nunca o e-mail pessoal do dono', async () => {
  const accountsBodies: Record<string, unknown>[] = []
  const handler: Handler = (url, method, body) => {
    if (url.includes('sandbox.asaas.com/api/v3/accounts') && method === 'POST') {
      accountsBodies.push(body as Record<string, unknown>)
      return new Response(JSON.stringify(ASAAS_ACCOUNT_NO_KEY), { status: 200 })
    }
    return baseHandler()(url, method, body)
  }
  const res = await withMock(handler, () => handleRequest(makeReq()))
  assertEquals(res.status, 201)
  assertEquals(accountsBodies[0]?.email, `empresa-${VALID_COMPANY.cnpj}@usealber.com`)
  assertEquals(accountsBodies[0]?.email !== OWNER.email, true)
})

Deno.test('sucesso — cria empresa com chave Pix própria (cnpj), sem tocar em dados pessoais', async () => {
  const insertedBodies: Record<string, unknown>[] = []
  const handler: Handler = (url, method, body) => {
    if (url.includes('/rest/v1/companies') && method === 'POST') insertedBodies.push(body as Record<string, unknown>)
    return baseHandler()(url, method, body)
  }
  const res  = await withMock(handler, () => handleRequest(makeReq({ ...VALID_COMPANY, pix_key_type: 'cnpj' })))
  const data = await res.json()

  assertEquals(res.status, 201)
  assertEquals(data.company_id, 'company-1')
  assertEquals(insertedBodies[0]?.owner_id, 'caller-1')
  assertEquals(insertedBodies[0]?.pix_key_type, 'cnpj')
  assertEquals(typeof insertedBodies[0]?.pix_key, 'string')
})

Deno.test('sucesso — pix_key_type ausente cria empresa sem chave configurada (comportamento de sempre)', async () => {
  const insertedBodies: Record<string, unknown>[] = []
  const handler: Handler = (url, method, body) => {
    if (url.includes('/rest/v1/companies') && method === 'POST') insertedBodies.push(body as Record<string, unknown>)
    return baseHandler()(url, method, body)
  }
  const res = await withMock(handler, () => handleRequest(makeReq(VALID_COMPANY)))
  assertEquals(res.status, 201)
  assertEquals(insertedBodies[0]?.pix_key, null)
  assertEquals(insertedBodies[0]?.pix_key_type, null)
})
