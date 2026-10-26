// Unit tests — webhooks-asaas-kyc com os eventos REAIS do Asaas
// (docs.asaas.com/docs/account-status-events): ACCOUNT_STATUS_GENERAL_APPROVAL_*, estado em accountStatus.general.
// Roda com: deno test supabase/functions/webhooks-asaas-kyc/events.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('ASAAS_WEBHOOK_SECRET', 'test-webhook-secret')

import { handleRequest } from './index.ts'
import { aesEncrypt } from '../_shared/crypto.ts'

type Call = { method: string; url: string; body: Record<string, unknown> | null }

function withMock<T>(company: unknown, fn: () => Promise<T>): Promise<{ result: T; calls: Call[] }> {
  const orig = globalThis.fetch
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/rest/v1/users') && method === 'GET') return ok([])
    if (url.includes('/rest/v1/companies') && method === 'GET') return ok(company ? [company] : [])
    if (url.includes('/rest/v1/')) return ok({}, 201)
    if (url.includes('/functions/v1/push-send')) return ok({})
    return ok({ error: `Unmocked ${method} ${url}` }, 500)
  }) as typeof fetch
  return fn().then((result) => ({ result, calls })).finally(() => { globalThis.fetch = orig })
}

const req = (payload: Record<string, unknown>) =>
  new Request('http://localhost/webhooks-asaas-kyc', { method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': 'test-webhook-secret' }, body: JSON.stringify(payload) })

const REAL = {
  id: 'evt_1&1', event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED', dateCreated: '2026-10-26 10:00:00',
  account: { id: 'asaas-acc-1', ownerId: 'parent-1' },
  accountStatus: { id: 'st_1', commercialInfo: 'APPROVED', bankAccountInfo: 'APPROVED', documentation: 'APPROVED', general: 'APPROVED' },
}

async function pendingCompany() {
  return { id: 'c1', owner_id: 'owner-1', kyc_status: 'pending', asaas_api_key_enc: await aesEncrypt('sub-api-key-raw', 'test-asaas-parent-key'), asaas_deposit_key: 'ja-tem' }
}
const patches = (calls: Call[]) => calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/companies')).map((c) => c.body as Record<string, unknown>)

Deno.test('GENERAL_APPROVAL_APPROVED no formato real (accountStatus.general) aprova a empresa', async () => {
  const { result, calls } = await withMock(await pendingCompany(), () => handleRequest(req(REAL)))
  assertEquals(result.status, 200)
  assertEquals(patches(calls).some((b) => b.kyc_status === 'approved'), true)
})

Deno.test('GENERAL_APPROVAL_REJECTED rejeita a empresa e libera o CNPJ (deleted_at)', async () => {
  const payload = { ...REAL, event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED', accountStatus: { general: 'REJECTED' } }
  const { result, calls } = await withMock(await pendingCompany(), () => handleRequest(req(payload)))
  assertEquals(result.status, 200)
  const p = patches(calls).find((b) => b.kyc_status === 'rejected')!
  assertEquals(typeof p.deleted_at, 'string')
})

Deno.test('sem accountStatus no corpo, o nome do evento define o resultado', async () => {
  const { result, calls } = await withMock(await pendingCompany(), () => handleRequest(req({ event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED', account: { id: 'asaas-acc-1', ownerId: null } })))
  assertEquals(result.status, 200)
  assertEquals(patches(calls).some((b) => b.kyc_status === 'approved'), true)
})

Deno.test('etapas parciais e eventos "em análise" ou "pendente" não mudam nada nem consultam o banco', async () => {
  for (const event of [
    'ACCOUNT_STATUS_DOCUMENT_APPROVED', 'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED', 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
    'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL', 'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
  ]) {
    const { result, calls } = await withMock(null, () => handleRequest(req({ ...REAL, event })))
    assertEquals(result.status, 200, event)
    assertEquals(calls.length, 0, event)
  }
})

Deno.test('aprovação repetida (o Asaas entrega "pelo menos uma vez") não grava de novo', async () => {
  const already = { ...(await pendingCompany()), kyc_status: 'approved' }
  const { result, calls } = await withMock(already, () => handleRequest(req(REAL)))
  assertEquals(result.status, 200)
  assertEquals(patches(calls).length, 0)
})
