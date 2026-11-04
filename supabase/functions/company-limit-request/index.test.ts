// Roda com: deno test supabase/functions/company-limit-request/index.test.ts --allow-env --allow-net
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const D = 24 * 3_600_000

interface World {
  company?: Record<string, unknown> | null
  callerId?: string
  recent?: number
  pending?: boolean
  insertError?: { code: string }
  cancelRows?: unknown[]
}

const baseCompany = { id: 'c1', owner_id: 'me', kyc_status: 'approved', kyc_approved_at: ago(90 * D), owner_link_review: 'not_needed', deleted_at: null, withdraw_limit_per_tx_brl: null, withdraw_limit_per_day_brl: null }

async function run(world: World, body: Record<string, unknown>, token: string | null = 'tok') {
  const inserted: Record<string, unknown>[] = []
  const updated: Record<string, unknown>[] = []
  const audits: Record<string, unknown>[] = []
  const company = world.company === undefined ? baseCompany : world.company
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    const j = init?.body ? JSON.parse(String(init.body)) : null
    const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
    if (url.includes('/auth/v1/user')) return res({ id: 'auth-1' })
    if (url.includes('/rest/v1/users')) return res({ id: world.callerId ?? 'me', deleted_at: null })
    if (url.includes('/rest/v1/audit_logs') && method === 'POST') { audits.push(j); return res({}, 201) }
    if (url.includes('/rest/v1/companies') && method === 'GET') return res(company)
    if (url.includes('/rest/v1/company_limit_requests')) {
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-0/${world.recent ?? 0}` } })
      if (method === 'GET') return res(world.pending ? { id: 'req-open' } : null)
      if (method === 'POST') {
        if (world.insertError) return res({ code: world.insertError.code, message: 'dup' }, 409)
        inserted.push(j)
        return res({ id: 'req-1', status: 'pending', requested_per_tx_brl: j.requested_per_tx_brl, requested_per_day_brl: j.requested_per_day_brl, current_per_tx_brl: j.current_per_tx_brl, current_per_day_brl: j.current_per_day_brl, created_at: new Date().toISOString() }, 201)
      }
      if (method === 'PATCH') { updated.push(j); return res(world.cancelRows ?? [{ id: 'req-open' }]) }
    }
    return res({ error: `Unmocked ${method} ${url}` }, 500)
  }) as typeof fetch
  try {
    const req = new Request('http://localhost/company-limit-request', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const res = await handleRequest(req)
    return { res, data: await res.json(), inserted, updated, audits }
  } finally {
    globalThis.fetch = orig
  }
}

const ask = { company_id: 'c1', per_tx_brl: 10000, per_day_brl: 50000, reason: 'Pagamos fornecedores todo dia 5 e o limite atual não cobre' }
const code = (r: { data: Record<string, unknown> }) => r.data.code

Deno.test('pedido válido: grava o pedido com o limite que valia, a auditoria leva só os números (nunca o motivo)', async () => {
  const r = await run({}, ask)
  assertEquals(r.res.status, 201)
  assertEquals(r.data.request.status, 'pending')
  assertEquals(r.inserted[0], { company_id: 'c1', requested_by: 'me', requested_per_tx_brl: 10000, requested_per_day_brl: 50000, current_per_tx_brl: 5000, current_per_day_brl: 20000, reason: ask.reason })
  assertEquals(r.audits[0]?.event_type, 'company_limit_requested')
  assertEquals(JSON.stringify(r.audits[0]).includes('fornecedores'), false)
})

Deno.test('empresa nova: o limite atual gravado é o de empresa nova; com limite aprovado, é o aprovado', async () => {
  const nova = await run({ company: { ...baseCompany, kyc_approved_at: ago(5 * D) } }, { ...ask, per_tx_brl: 3000, per_day_brl: 6000 })
  assertEquals([nova.res.status, nova.inserted[0]?.current_per_tx_brl, nova.inserted[0]?.current_per_day_brl], [201, 1000, 2000])
  const aprovada = await run({ company: { ...baseCompany, withdraw_limit_per_tx_brl: '8000.00', withdraw_limit_per_day_brl: '30000.00' } }, { ...ask, per_tx_brl: 12000, per_day_brl: 60000 })
  assertEquals([aprovada.res.status, aprovada.inserted[0]?.current_per_tx_brl, aprovada.inserted[0]?.current_per_day_brl], [201, 8000, 30000])
})

Deno.test('só o master pede (operador e outro usuário: 403); sem token, 401; empresa inexistente ou excluída, 404', async () => {
  assertEquals((await run({ callerId: 'outro' }, ask)).res.status, 403)
  assertEquals((await run({}, ask, null)).res.status, 401)
  assertEquals((await run({ company: null }, ask)).res.status, 404)
  assertEquals((await run({ company: { ...baseCompany, deleted_at: ago(D) } }, ask)).res.status, 404)
  assertEquals((await run({}, { per_tx_brl: 1 })).res.status, 400)
})

Deno.test('empresa que não foi aprovada no KYC não pede; vínculo em revisão ou recusado também não (já não saca)', async () => {
  const kyc = await run({ company: { ...baseCompany, kyc_status: 'pending' } }, ask)
  assertEquals([kyc.res.status, code(kyc)], [422, 'COMPANY_NOT_APPROVED'])
  const pend = await run({ company: { ...baseCompany, owner_link_review: 'pending' } }, ask)
  assertEquals([pend.res.status, code(pend)], [403, 'OWNER_LINK_PENDING'])
  const rej = await run({ company: { ...baseCompany, owner_link_review: 'rejected' } }, ask)
  assertEquals([rej.res.status, code(rej)], [403, 'OWNER_LINK_REJECTED'])
  const legacy = await run({ company: { ...baseCompany, owner_link_review: 'legacy' } }, ask)
  assertEquals(legacy.res.status, 201) // anterior à regra: segue funcionando
})

Deno.test('valores inválidos, abaixo do atual, iguais ao atual ou acima do teto: 422 e nada é gravado', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ per_tx_brl: 'abc' }, 'LIMIT_INVALID'],
    [{ per_tx_brl: 0 }, 'LIMIT_INVALID'],
    [{ per_tx_brl: -10 }, 'LIMIT_INVALID'],
    [{ per_tx_brl: 10000, per_day_brl: 9000 }, 'LIMIT_INVALID'], // dia menor que saque
    [{ per_tx_brl: undefined }, 'LIMIT_INVALID'],
    [{ per_tx_brl: 500001, per_day_brl: 600000 }, 'LIMIT_ABOVE_CAP'],
    [{ per_tx_brl: 10000, per_day_brl: 2000001 }, 'LIMIT_ABOVE_CAP'],
    [{ per_tx_brl: 5000, per_day_brl: 20000 }, 'LIMIT_NOT_HIGHER'], // igual ao atual
    [{ per_tx_brl: 4000, per_day_brl: 50000 }, 'LIMIT_NOT_HIGHER'], // baixaria o limite por saque
    [{ per_tx_brl: 10000, per_day_brl: 15000 }, 'LIMIT_NOT_HIGHER'], // baixaria o limite diário
    [{ reason: 'curto' }, 'REASON_INVALID'],
    [{ reason: 'x'.repeat(501) }, 'REASON_INVALID'],
    [{ reason: undefined }, 'REASON_INVALID'],
  ]
  for (const [over, expected] of cases) {
    const r = await run({}, { ...ask, ...over })
    assertEquals([r.res.status, code(r)], [422, expected], JSON.stringify(over))
    assertEquals(r.inserted.length, 0, JSON.stringify(over))
  }
  // teto exato é aceito; aumentar só um dos dois é aceito
  assertEquals((await run({}, { ...ask, per_tx_brl: 500000, per_day_brl: 2000000 })).res.status, 201)
  assertEquals((await run({}, { ...ask, per_tx_brl: 5000, per_day_brl: 30000 })).res.status, 201)
})

Deno.test('um pedido em aberto por vez (409), inclusive quando dois chegam juntos (índice único); 3 por dia (429)', async () => {
  const open = await run({ pending: true }, ask)
  assertEquals([open.res.status, code(open)], [409, 'LIMIT_REQUEST_PENDING'])
  const race = await run({ insertError: { code: '23505' } }, ask)
  assertEquals([race.res.status, code(race)], [409, 'LIMIT_REQUEST_PENDING'])
  const many = await run({ recent: 3 }, ask)
  assertEquals([many.res.status, code(many)], [429, 'RATE_LIMITED'])
  assertEquals((await run({ recent: 2 }, ask)).res.status, 201)
})

Deno.test('cancelar: fecha o pedido em aberto; sem pedido, 404; não exige empresa aprovada', async () => {
  const ok = await run({}, { company_id: 'c1', cancel: true })
  assertEquals([ok.res.status, ok.data.status], [200, 'cancelled'])
  assertEquals(ok.updated[0]?.status, 'cancelled')
  assertEquals(ok.audits[0]?.event_type, 'company_limit_cancelled')
  const none = await run({ cancelRows: [] }, { company_id: 'c1', cancel: true })
  assertEquals([none.res.status, code(none)], [404, 'LIMIT_REQUEST_NOT_FOUND'])
  assertEquals((await run({ company: { ...baseCompany, kyc_status: 'pending' } }, { company_id: 'c1', cancel: true })).res.status, 200)
  assertEquals((await run({ callerId: 'outro' }, { company_id: 'c1', cancel: true })).res.status, 403)
})
