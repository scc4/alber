// Unit tests — consulta de situação do KYC de empresa (pollCompanyKyc) e company-list
// Roda com: deno test supabase/functions/_shared/company-kyc.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { aesEncrypt } from './crypto.ts'
import { pollCompanyKyc } from './company-kyc.ts'
// company-list cria o cliente do Supabase ao carregar: só pode ser importado depois das variáveis acima.
const { handleRequest: companyList } = await import('../company-list/index.ts')

interface Call { method: string; url: string; body: Record<string, unknown> | null; headers: Record<string, string> }
const calls: Call[] = []

interface Mock { company?: unknown; general?: string | null; statusFails?: boolean; ownedPending?: unknown[] }

function withMock<T>(m: Mock, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  calls.length = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> })
    const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/myAccount/status')) return m.statusFails ? ok({ error: 'x' }, 500) : ok({ id: 'acc', general: m.general ?? 'PENDING', commercialInfo: 'APPROVED' })
    if (url.includes('/pix/addressKeys')) return ok({ key: 'evp-key', type: 'EVP' })
    if (url.includes('/auth/v1/user')) return ok({ id: 'auth-1' })
    if (url.includes('/rest/v1/users')) return ok([{ id: 'user-1' }])
    if (url.includes('/rest/v1/companies') && method === 'GET' && url.includes('kyc_status=in.')) return ok(m.ownedPending ?? [])
    if (url.includes('/rest/v1/companies') && method === 'GET') return ok(m.company ? [m.company] : [])
    if (url.includes('/rest/v1/company_operators')) return ok([])
    if (url.includes('/rest/v1/')) return ok({}, 201)
    if (url.includes('/functions/v1/push-send')) return ok({})
    return ok({ error: `Unmocked ${method} ${url}` }, 500)
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

async function company(over: Record<string, unknown> = {}) {
  return { id: 'c1', owner_id: 'owner-1', kyc_status: 'pending', asaas_account_id: 'asaas-1', asaas_deposit_key: null, asaas_api_key_enc: await aesEncrypt('sub-key', 'test-asaas-parent-key'), ...over }
}
const admin = () => createClient('http://localhost-test', 'test-srk')
const patches = () => calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/companies')).map((c) => c.body as Record<string, unknown>)

Deno.test('empresa pendente que o Asaas já aprovou: grava approved, cria a chave Pix e consulta com a chave da SUBCONTA', async () => {
  const r = await withMock({ company: await company(), general: 'APPROVED' }, () => pollCompanyKyc(admin(), 'c1'))
  assertEquals(r, 'approved')
  assertEquals(patches().some((b) => b.kyc_status === 'approved' && typeof b.onboarding_completed_at === 'string'), true)
  assertEquals(patches().some((b) => 'asaas_deposit_key' in b), true)
  const status = calls.find((c) => c.url.includes('/myAccount/status'))!
  assertEquals(status.headers['access_token'], 'sub-key') // nunca a chave da conta pai
  const audit = calls.find((c) => c.url.includes('/rest/v1/audit_logs'))!
  assertEquals((audit.body as { metadata: { via: string } }).metadata.via, 'poll')
})

Deno.test('ainda em análise, pendente ou rejeitada no Asaas: não muda nada (rejeição só pelo webhook)', async () => {
  for (const general of ['PENDING', 'AWAITING_APPROVAL', 'REJECTED']) {
    const r = await withMock({ company: await company(), general }, () => pollCompanyKyc(admin(), 'c1'))
    assertEquals(r, 'pending', general)
    assertEquals(patches().length, 0, general)
  }
})

Deno.test('empresa já aprovada, sem chave ou inexistente: nem consulta o Asaas', async () => {
  for (const c of [await company({ kyc_status: 'approved' }), await company({ asaas_api_key_enc: null }), null]) {
    await withMock({ company: c }, () => pollCompanyKyc(admin(), 'c1'))
    assertEquals(calls.some((x) => x.url.includes('/myAccount/status')), false)
    assertEquals(patches().length, 0)
  }
})

Deno.test('Asaas fora do ar ou chave que não decifra: não lança e não grava', async () => {
  assertEquals(await withMock({ company: await company(), statusFails: true }, () => pollCompanyKyc(admin(), 'c1')), 'pending')
  assertEquals(patches().length, 0)
  assertEquals(await withMock({ company: await company({ asaas_api_key_enc: 'lixo-que-nao-decifra' }) }, () => pollCompanyKyc(admin(), 'c1')), null)
  assertEquals(patches().length, 0)
})

Deno.test('company-list confere as empresas pendentes do master antes de listar', async () => {
  const req = new Request('http://localhost/company-list', { method: 'GET', headers: { Authorization: 'Bearer user-jwt' } })
  const res = await withMock({ ownedPending: [{ id: 'c1' }], company: await company(), general: 'APPROVED' }, () => companyList(req))
  assertEquals(res.status, 200)
  assertEquals(patches().some((b) => b.kyc_status === 'approved'), true)
  // A consulta aconteceu antes de ler a lista de empresas.
  const iStatus = calls.findIndex((c) => c.url.includes('/myAccount/status'))
  const iList = calls.findIndex((c, i) => i > iStatus && c.url.includes('/rest/v1/companies') && c.method === 'GET')
  assertEquals(iStatus >= 0 && iList > iStatus, true)
})

Deno.test('company-list sem empresa pendente não chama o Asaas; sem token, 401', async () => {
  const req = new Request('http://localhost/company-list', { method: 'GET', headers: { Authorization: 'Bearer user-jwt' } })
  assertEquals((await withMock({ ownedPending: [] }, () => companyList(req))).status, 200)
  assertEquals(calls.some((c) => c.url.includes('/myAccount/status')), false)
  assertEquals((await withMock({}, () => companyList(new Request('http://localhost/x', { method: 'GET' })))).status, 401)
})
