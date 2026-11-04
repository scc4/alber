// Roda com: deno test supabase/functions/food-company-abandon/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { ago, call, COMPANY_ID, D, installWorld, makeWorld, OTHER_OWNER_REF, OWNER_REF, uniq, withLiveWorld } from '../_shared/food-test-kit.ts'
import { handleRequest } from './index.ts'

const body = { company_id: COMPANY_ID, owner_ref: OWNER_REF }
const company = (w: Awaited<ReturnType<typeof makeWorld>>) => w.db.rows('companies')[0]!

Deno.test('cancela o cadastro pendente: deleted_at e deleted_reason, resposta { company_id, abandoned }, auditoria sem usuário com via food', async () => {
  const w = await makeWorld({ override: { kyc_status: 'pending', account_status: 'evaluation', kyc_approved_at: null } })
  const r = await call(w, handleRequest, body)
  assertEquals([r.status, r.data], [200, { company_id: COMPANY_ID, abandoned: true }])
  assertEquals(typeof company(w).deleted_at, 'string')
  assertEquals(company(w).deleted_reason, 'abandoned')
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'company_abandoned')
  assertEquals(audit?.user_id, null)
  assertEquals(audit?.metadata, { company_id: COMPANY_ID, previous_kyc_status: 'pending', via: 'food', owner_ref: OWNER_REF })
  assertEquals(w.asaas.length + w.pushes.length, 0) // não mexe na subconta do Asaas nem avisa ninguém
})

Deno.test('libera o CNPJ e o @ na hora: o mesmo dono (ou outro) abre de novo; o status passa a 404', async () => {
  const w = await makeWorld({ override: { kyc_status: 'pending', kyc_approved_at: null } })
  // o índice único de CNPJ/@ só vale para empresa viva (deleted_at nulo): antes de cancelar, outra linha com o mesmo CNPJ e @ é recusada...
  const dup = { id: 'nova', handle: company(w).handle, cnpj: company(w).cnpj, asaas_account_id: 'acc_2', owner_ref: OTHER_OWNER_REF, deleted_at: null }
  const insertDup = async () => {
    const restore = installWorld(w)
    try {
      return (await fetch('https://supabase.test/rest/v1/companies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...dup, asaas_account_id: uniq('acc') }) })).status
    } finally {
      restore()
    }
  }
  assertEquals(await insertDup(), 409)
  assertEquals((await call(w, handleRequest, body)).status, 200)
  // ...e depois de cancelar a nova entra
  assertEquals(await insertDup(), 201)
  const { handleRequest: status } = await import('../food-company-status/index.ts')
  assertEquals((await call(w, status, body)).status, 404)
})

Deno.test('empresa já cancelada: 409 ALREADY_ABANDONED, sem gravar de novo', async () => {
  const when = ago(2 * D)
  const w = await makeWorld({ override: { kyc_status: 'pending', deleted_at: when, deleted_reason: 'abandoned' } })
  const r = await call(w, handleRequest, body)
  assertEquals([r.status, r.data.code], [409, 'ALREADY_ABANDONED'])
  assertEquals(company(w).deleted_at, when)
  assertEquals(w.db.calls('PATCH', 'companies').length, 0)
})

Deno.test('empresa com KYC aprovado: 422 COMPANY_ALREADY_APPROVED e nada é apagado', async () => {
  const w = await makeWorld() // aprovada
  const r = await call(w, handleRequest, body)
  assertEquals([r.status, r.data.code], [422, 'COMPANY_ALREADY_APPROVED'])
  assertEquals(company(w).deleted_at, null)
  assertEquals(w.db.calls('PATCH', 'companies').length, 0)
  assertEquals(w.db.rows('audit_logs').filter((a) => a.event_type === 'company_abandoned').length, 0)
})

Deno.test('KYC recusado (ainda sem deleted_at) e em análise (submitted) podem ser cancelados', async () => {
  for (const kyc of ['submitted', 'rejected']) {
    const w = await makeWorld({ override: { kyc_status: kyc, kyc_approved_at: null } })
    assertEquals((await call(w, handleRequest, body)).status, 200, kyc)
  }
})

Deno.test('dono errado, empresa inexistente e empresa do app (sem owner_ref): todos 404 COMPANY_NOT_FOUND, sem revelar nada e sem gravar', async () => {
  const w = await makeWorld({ override: { kyc_status: 'pending', kyc_approved_at: null } })
  const wrong = await call(w, handleRequest, { ...body, owner_ref: OTHER_OWNER_REF })
  assertEquals([wrong.status, wrong.data.code], [404, 'COMPANY_NOT_FOUND'])
  assertEquals(company(w).deleted_at, null)

  assertEquals((await call(await makeWorld({ override: null }), handleRequest, body)).data.code, 'COMPANY_NOT_FOUND')
  const app = await makeWorld({ override: { kyc_status: 'pending', owner_ref: null, owner_id: 'user-1', origin: 'app' } })
  assertEquals((await call(app, handleRequest, body)).data.code, 'COMPANY_NOT_FOUND')
  assertEquals(app.db.rows('companies')[0]?.deleted_at, null)

  // empresa já cancelada de OUTRO dono também é 404 (não vaza o estado)
  const other = await makeWorld({ override: { kyc_status: 'pending', deleted_at: ago(D) } })
  assertEquals((await call(other, handleRequest, { ...body, owner_ref: OTHER_OWNER_REF })).data.code, 'COMPANY_NOT_FOUND')
})

Deno.test('corrida: aprovada entre a leitura e a gravação, a empresa NÃO é apagada e a resposta é COMPANY_ALREADY_APPROVED', async () => {
  const w = await makeWorld({ override: { kyc_status: 'pending', kyc_approved_at: null } })
  // simula o Asaas aprovando logo depois da leitura: o PATCH encontra a empresa já aprovada
  const realHandle = w.db.handle.bind(w.db)
  let patched = false
  w.db.handle = (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'PATCH' && !patched) {
      patched = true
      company(w).kyc_status = 'approved'
    }
    return realHandle(url, init)
  }
  const r = await call(w, handleRequest, body)
  assertEquals([r.status, r.data.code], [422, 'COMPANY_ALREADY_APPROVED'])
  assertEquals(company(w).deleted_at, null)
  assertEquals(w.db.rows('audit_logs').filter((a) => a.event_type === 'company_abandoned').length, 0)
})

Deno.test('dois cancelamentos ao mesmo tempo: um 200 e o outro 409 ALREADY_ABANDONED, uma só auditoria', async () => {
  const w = await makeWorld({ override: { kyc_status: 'pending', kyc_approved_at: null } })
  const [a, b] = await withLiveWorld(w, () => Promise.all([call(w, handleRequest, body), call(w, handleRequest, body)]))
  assertEquals([a.status, b.status].sort(), [200, 409])
  assertEquals([a, b].find((r) => r.status === 409)?.data.code, 'ALREADY_ABANDONED')
  assertEquals(w.db.rows('audit_logs').filter((x) => x.event_type === 'company_abandoned').length, 1)
})

Deno.test('erro de banco: leitura 503; gravação 500 DB_ERROR sem auditoria', async () => {
  const read = await makeWorld({ override: { kyc_status: 'pending', kyc_approved_at: null } })
  read.db.failOn.push({ method: 'GET', table: 'companies' })
  assertEquals((await call(read, handleRequest, body)).status, 503)

  const write = await makeWorld({ override: { kyc_status: 'pending', kyc_approved_at: null } })
  write.db.failOn.push({ method: 'PATCH', table: 'companies' })
  const r = await call(write, handleRequest, body)
  assertEquals([r.status, r.data.code], [500, 'DB_ERROR'])
  assertEquals(write.db.rows('audit_logs').filter((a) => a.event_type === 'company_abandoned').length, 0)
  assert(write.db.rows('error_logs').some((e) => e.function === 'food-company-abandon'))
})

Deno.test('ids inválidos 422; chamada de serviço: só POST, só com a chave do Food, JSON válido', async () => {
  const w = await makeWorld({ override: { kyc_status: 'pending', kyc_approved_at: null } })
  assertEquals((await call(w, handleRequest, { ...body, company_id: 'x' })).data.code, 'INVALID_COMPANY')
  assertEquals((await call(w, handleRequest, { company_id: COMPANY_ID })).data.code, 'INVALID_OWNER')
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' })).status, 405)
  for (const key of [null, 'errada', 'f'.repeat(41)]) assertEquals((await call(w, handleRequest, body, { key })).status, 401)
  assertEquals((await call(w, handleRequest, null, { rawBody: '{x' })).data.code, 'INVALID_BODY')
  assertEquals(company(w).deleted_at, null)
})
