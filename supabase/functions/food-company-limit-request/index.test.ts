// Roda com: deno test supabase/functions/food-company-limit-request/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { ago, call, COMPANY_ID, D, H, makeWorld, OTHER_OWNER_REF, OWNER_REF, uniq, type World } from '../_shared/food-test-kit.ts'
import { handleRequest } from './index.ts'

const ask = { company_id: COMPANY_ID, owner_ref: OWNER_REF, per_tx_brl: 10000, per_day_brl: 50000, reason: 'Pagamos fornecedores todo dia 5 e o limite atual não cobre' }
const run = (w: World, over: Record<string, unknown> = {}, opts: Parameters<typeof call>[3] = {}) => call(w, handleRequest, { ...ask, ...over }, opts)
const requests = (w: World) => w.db.rows('company_limit_requests')

Deno.test('pedido válido: grava o limite que valia, o dono em requested_by_ref (sem usuário), e a auditoria leva só os números', async () => {
  const w = await makeWorld()
  const r = await run(w)
  assertEquals(r.status, 201)
  const req = r.data.request as Record<string, unknown>
  assertEquals([req.status, req.requested_per_tx_brl, req.requested_per_day_brl, req.current_per_tx_brl, req.current_per_day_brl], ['pending', 10000, 50000, 5000, 20000])
  assertEquals(Object.keys(req).sort(), ['created_at', 'current_per_day_brl', 'current_per_tx_brl', 'id', 'requested_per_day_brl', 'requested_per_tx_brl', 'status'])

  const [row] = requests(w)
  assertEquals([row?.company_id, row?.requested_by_ref, 'requested_by' in (row ?? {}), row?.reason], [COMPANY_ID, OWNER_REF, false, ask.reason])
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'company_limit_requested')
  assertEquals(audit?.user_id, null)
  assertEquals((audit?.metadata as Record<string, unknown>).owner_ref, OWNER_REF)
  assert(!JSON.stringify(audit).includes('fornecedores')) // o motivo é texto livre: fica só no pedido
})

Deno.test('o limite "atual" gravado é o de empresa nova, ou o aprovado pela equipe', async () => {
  const nova = await makeWorld({ override: { kyc_approved_at: ago(5 * D) } })
  const r1 = await run(nova, { per_tx_brl: 3000, per_day_brl: 6000 })
  assertEquals([r1.status, requests(nova)[0]?.current_per_tx_brl, requests(nova)[0]?.current_per_day_brl], [201, 1000, 2000])
  const aprovada = await makeWorld({ override: { withdraw_limit_per_tx_brl: '8000.00', withdraw_limit_per_day_brl: '30000.00' } })
  const r2 = await run(aprovada, { per_tx_brl: 12000, per_day_brl: 60000 })
  assertEquals([r2.status, requests(aprovada)[0]?.current_per_tx_brl, requests(aprovada)[0]?.current_per_day_brl], [201, 8000, 30000])
})

Deno.test('regras do pedido: empresa aprovada, vínculo em ordem, valores, teto, subir sem baixar, motivo', async () => {
  const code = async (over: Record<string, unknown>, world?: World) => (await run(world ?? await makeWorld(), over)).data.code
  assertEquals((await run(await makeWorld({ override: { kyc_status: 'pending' } }))).data.code, 'COMPANY_NOT_APPROVED')
  assertEquals((await run(await makeWorld({ override: { owner_link_review: 'pending' } }))).data.code, 'OWNER_LINK_PENDING')
  assertEquals((await run(await makeWorld({ override: { owner_link_review: 'rejected' } }))).data.code, 'OWNER_LINK_REJECTED')
  for (const bad of [{ per_tx_brl: 'abc' }, { per_tx_brl: 0 }, { per_tx_brl: -5 }, { per_day_brl: 9000 }, { per_tx_brl: undefined }, { per_day_brl: null }]) {
    assertEquals(await code(bad), 'LIMIT_INVALID')
  }
  const above = await run(await makeWorld(), { per_tx_brl: 500_001, per_day_brl: 600_000 })
  assertEquals([above.status, above.data.code, above.data.max_per_tx_brl, above.data.max_per_day_brl], [422, 'LIMIT_ABOVE_CAP', 500000, 2000000])
  assertEquals(await code({ per_day_brl: 2_000_001 }), 'LIMIT_ABOVE_CAP')
  for (const reason of ['curto', 'x'.repeat(501), undefined, 5]) assertEquals(await code({ reason }), 'REASON_INVALID')
  const notHigher = await run(await makeWorld(), { per_tx_brl: 4000, per_day_brl: 50000 })
  assertEquals([notHigher.status, notHigher.data.code, notHigher.data.current_per_tx_brl, notHigher.data.current_per_day_brl], [422, 'LIMIT_NOT_HIGHER', 5000, 20000])
  assertEquals(await code({ per_tx_brl: 5000, per_day_brl: 20000 }), 'LIMIT_NOT_HIGHER') // igual ao atual
})

Deno.test('um pedido aberto por empresa (409) e no máximo 3 por dia (429)', async () => {
  const w = await makeWorld()
  assertEquals((await run(w)).status, 201)
  const second = await run(w, { per_tx_brl: 11000 })
  assertEquals([second.status, second.data.code], [409, 'LIMIT_REQUEST_PENDING'])
  assertEquals(requests(w).length, 1)

  const busy = await makeWorld({
    rows: { company_limit_requests: Array.from({ length: 3 }, () => ({ id: uniq('r'), company_id: COMPANY_ID, status: 'rejected', requested_by_ref: OWNER_REF, created_at: ago(2 * H) })) },
  })
  const r = await run(busy)
  assertEquals([r.status, r.data.code], [429, 'RATE_LIMITED'])
  const old = await makeWorld({
    rows: { company_limit_requests: Array.from({ length: 3 }, () => ({ id: uniq('r'), company_id: COMPANY_ID, status: 'rejected', requested_by_ref: OWNER_REF, created_at: ago(30 * H) })) },
  })
  assertEquals((await run(old)).status, 201)
})

Deno.test('dois pedidos ao mesmo tempo: o índice único deixa passar só um', async () => {
  const w = await makeWorld()
  const { withLiveWorld } = await import('../_shared/food-test-kit.ts')
  const [a, b] = await withLiveWorld(w, () => Promise.all([run(w), run(w)]))
  assertEquals([a.status, b.status].sort(), [201, 409])
  assertEquals(requests(w).length, 1)
})

Deno.test('dono errado 403 NOT_OWNER; empresa inexistente ou removida 404; empresa do app nunca é do Food; ids inválidos 422', async () => {
  const w = await makeWorld()
  assertEquals((await run(w, { owner_ref: OTHER_OWNER_REF })).data.code, 'NOT_OWNER')
  assertEquals((await run(await makeWorld({ override: null }))).status, 404)
  assertEquals((await run(await makeWorld({ override: { deleted_at: ago(D) } }))).status, 404)
  assertEquals((await run(await makeWorld({ override: { owner_ref: null, owner_id: 'u1', origin: 'app' } }))).data.code, 'NOT_OWNER')
  assertEquals((await run(w, { company_id: 'x' })).data.code, 'INVALID_COMPANY')
  assertEquals((await run(w, { owner_ref: undefined })).data.code, 'INVALID_OWNER')
  assertEquals(requests(w).length, 0)
})

Deno.test('chamada de serviço: só POST, só com a chave do Food, JSON válido', async () => {
  const w = await makeWorld()
  assertEquals((await run(w, {}, { method: 'GET' })).status, 405)
  for (const key of [null, 'errada']) assertEquals((await run(w, {}, { key })).status, 401)
  assertEquals((await call(w, handleRequest, null, { rawBody: '{x' })).data.code, 'INVALID_BODY')
  assertEquals(requests(w).length, 0)
})
