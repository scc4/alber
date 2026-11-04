// Roda com: deno test supabase/functions/food-company-limit-cancel/index.test.ts --allow-env --allow-net --allow-read
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { ago, call, COMPANY_ID, D, makeWorld, OTHER_OWNER_REF, OWNER_REF } from '../_shared/food-test-kit.ts'
import { handleRequest } from './index.ts'

const body = { company_id: COMPANY_ID, owner_ref: OWNER_REF }
const pending = (over: Record<string, unknown> = {}) => ({ id: 'req-1', company_id: COMPANY_ID, status: 'pending', requested_by_ref: OWNER_REF, requested_per_tx_brl: '10000', requested_per_day_brl: '50000', created_at: ago(D / 2), ...over })

Deno.test('cancela o pedido em aberto: { status: cancelled }, auditoria sem usuário, outros pedidos não mudam', async () => {
  const w = await makeWorld({ rows: { company_limit_requests: [pending(), pending({ id: 'old', status: 'rejected' }), pending({ id: 'other-company', company_id: 'outra' })] } })
  const r = await call(w, handleRequest, body)
  assertEquals([r.status, r.data], [200, { status: 'cancelled' }])
  const statuses = Object.fromEntries(w.db.rows('company_limit_requests').map((x) => [x.id, x.status]))
  assertEquals(statuses, { 'req-1': 'cancelled', old: 'rejected', 'other-company': 'pending' })
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'company_limit_cancelled')
  assertEquals([audit?.user_id, (audit?.metadata as Record<string, unknown>).request_id, (audit?.metadata as Record<string, unknown>).owner_ref], [null, 'req-1', OWNER_REF])
})

Deno.test('sem pedido em aberto: 404 LIMIT_REQUEST_NOT_FOUND', async () => {
  const w = await makeWorld({ rows: { company_limit_requests: [pending({ status: 'approved' })] } })
  const r = await call(w, handleRequest, body)
  assertEquals([r.status, r.data.code], [404, 'LIMIT_REQUEST_NOT_FOUND'])
})

Deno.test('cancelar duas vezes: a segunda dá 404', async () => {
  const w = await makeWorld({ rows: { company_limit_requests: [pending()] } })
  assertEquals((await call(w, handleRequest, body)).status, 200)
  assertEquals((await call(w, handleRequest, body)).status, 404)
})

Deno.test('dono errado 403 NOT_OWNER (o pedido fica); empresa inexistente 404; ids inválidos 422', async () => {
  const w = await makeWorld({ rows: { company_limit_requests: [pending()] } })
  assertEquals((await call(w, handleRequest, { ...body, owner_ref: OTHER_OWNER_REF })).data.code, 'NOT_OWNER')
  assertEquals(w.db.rows('company_limit_requests')[0]?.status, 'pending')
  assertEquals((await call(await makeWorld({ override: null }), handleRequest, body)).status, 404)
  assertEquals((await call(w, handleRequest, { ...body, company_id: 'x' })).data.code, 'INVALID_COMPANY')
  assertEquals((await call(w, handleRequest, { company_id: COMPANY_ID })).data.code, 'INVALID_OWNER')
})

Deno.test('chamada de serviço: só POST, só com a chave do Food, JSON válido', async () => {
  const w = await makeWorld({ rows: { company_limit_requests: [pending()] } })
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' })).status, 405)
  for (const key of [null, 'errada']) assertEquals((await call(w, handleRequest, body, { key })).status, 401)
  assertEquals((await call(w, handleRequest, null, { rawBody: 'xx' })).data.code, 'INVALID_BODY')
  assertEquals(w.db.rows('company_limit_requests')[0]?.status, 'pending')
})
