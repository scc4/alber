// Roda com: deno test supabase/functions/food-company-withdraw-status/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { ago, call, COMPANY_ID, D, H, makeWorld, OTHER_OWNER_REF, OWNER_REF, withdrawOp } from '../_shared/food-test-kit.ts'
import { handleRequest as withdraw } from '../food-company-withdraw/index.ts'
import { handleRequest as webhook } from '../webhooks-asaas-pix/index.ts'
import { handleRequest } from './index.ts'

const T = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`
const tx = (n: number, over: Record<string, unknown> = {}) => ({
  id: T(n), company_id: COMPANY_ID, user_id: null, actor_ref: OWNER_REF, type: 'descarregar', amount: '1500.00', status: 'processing',
  asaas_payment_id: `tr_${n}`, metadata: { via: 'food', destination_masked: '11222333***' }, created_at: ago(H), ...over,
})
const body = (ids: unknown, extra: Record<string, unknown> = {}) => ({ company_id: COMPANY_ID, owner_ref: OWNER_REF, transaction_ids: ids, ...extra })

Deno.test('devolve os saques pedidos: processing, completed (com a data do webhook) e failed (código genérico), na ordem pedida', async () => {
  const doneAt = ago(10 * 60_000)
  const w = await makeWorld({
    rows: {
      transactions: [
        tx(1, { status: 'pending' }),
        tx(2, { status: 'completed', amount: '20.50' }),
        tx(3, { status: 'failed' }),
      ],
      audit_logs: [
        { id: 'a1', event_type: 'descarregar_completed', metadata: { transaction_id: T(2) }, created_at: doneAt },
        { id: 'a2', event_type: 'descarregar_failed', metadata: { transaction_id: T(3), texto: 'segredo do asaas' }, created_at: doneAt },
      ],
    },
  })
  const r = await call(w, handleRequest, body([T(3), T(1), T(2)]))
  assertEquals(r.status, 200)
  const items = r.data.items as Array<Record<string, unknown>>
  assertEquals(items.map((i) => i.transaction_id), [T(3), T(1), T(2)])
  assertEquals(items[0], { transaction_id: T(3), status: 'failed', amount_cents: 150000, destination_masked: '11222333***', created_at: items[0]!.created_at, completed_at: doneAt, failure_code: 'TRANSFER_FAILED' })
  assertEquals([items[1]!.status, items[1]!.completed_at, items[1]!.failure_code], ['processing', null, null])
  assertEquals([items[2]!.status, items[2]!.amount_cents, items[2]!.completed_at, items[2]!.failure_code], ['completed', 2050, doneAt, null])
  assert(!JSON.stringify(r.data).includes('segredo do asaas'))
  assertEquals(w.db.log.filter((l) => l.method !== 'GET').length, 0) // somente leitura
})

Deno.test('só saques DESTA empresa: ids de outra empresa, de outro tipo, do app e inexistentes não aparecem (sem erro)', async () => {
  const w = await makeWorld({
    rows: {
      transactions: [
        tx(1),
        tx(2, { company_id: 'outra-empresa' }),
        tx(3, { type: 'fee' }),
        tx(4, { metadata: {}, user_id: 'u1' }), // descarregar feito pelo app, sem via food
      ],
    },
  })
  const r = await call(w, handleRequest, body([T(1), T(2), T(3), T(4), T(5)]))
  assertEquals([r.status, (r.data.items as Array<Record<string, unknown>>).map((i) => i.transaction_id)], [200, [T(1)]])
  const none = await call(w, handleRequest, body([T(9)]))
  assertEquals([none.status, none.data.items], [200, []])
})

Deno.test('ids repetidos viram um só; 0 ou mais de 20 ids, não-UUID ou não-lista: 422', async () => {
  const w = await makeWorld({ rows: { transactions: [tx(1)] } })
  assertEquals(((await call(w, handleRequest, body([T(1), T(1), T(1).toUpperCase()]))).data.items as unknown[]).length, 1)
  const many = Array.from({ length: 20 }, (_, i) => T(i + 1))
  assertEquals((await call(w, handleRequest, body(many))).status, 200)
  for (const bad of [[], [...many, T(21)], ['x'], [T(1), 5], 'abc', null, undefined, { 0: T(1) }]) {
    const r = await call(w, handleRequest, body(bad))
    assertEquals([r.status, r.data.code], [422, 'INVALID_TRANSACTION_IDS'])
  }
})

Deno.test('empresa de outro dono, inexistente, removida ou do app: 404 COMPANY_NOT_FOUND (nunca 403)', async () => {
  const w = await makeWorld({ rows: { transactions: [tx(1)] } })
  const other = await call(w, handleRequest, body([T(1)], { owner_ref: OTHER_OWNER_REF }))
  assertEquals([other.status, other.data.code, other.data.items], [404, 'COMPANY_NOT_FOUND', undefined])
  assertEquals((await call(await makeWorld({ override: null }), handleRequest, body([T(1)]))).status, 404)
  assertEquals((await call(await makeWorld({ override: { deleted_at: ago(D) } }), handleRequest, body([T(1)]))).status, 404)
  assertEquals((await call(await makeWorld({ override: { owner_ref: null, owner_id: 'u', origin: 'app' } }), handleRequest, body([T(1)]))).data.code, 'COMPANY_NOT_FOUND')
})

Deno.test('de ponta a ponta: saque criado por food-company-withdraw, processing; depois do webhook TRANSFER_DONE, completed com data', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000)
  const made = await call(w, withdraw, { company_id: COMPANY_ID, owner_ref: OWNER_REF, amount_cents: 150_000, op: s.op }, { signature: s.signature })
  const id = made.data.transaction_id as string
  const before = await call(w, handleRequest, body([id]))
  const it0 = (before.data.items as Array<Record<string, unknown>>)[0]!
  assertEquals([it0.status, it0.amount_cents, it0.destination_masked, it0.completed_at], ['processing', 150000, '11222333***', null])

  Deno.env.set('ASAAS_WEBHOOK_SECRET', 'webhook-secret-test')
  const hook = new Request('http://localhost/hook', {
    method: 'POST', headers: { 'asaas-access-token': 'webhook-secret-test', 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'TRANSFER_DONE', transfer: { id: 'tr_1', status: 'DONE', value: 1500 } }),
  })
  assertEquals((await call(w, (_r: Request) => webhook(hook), {}, {})).status, 200)
  const after = await call(w, handleRequest, body([id]))
  const it1 = (after.data.items as Array<Record<string, unknown>>)[0]!
  assertEquals([it1.status, typeof it1.completed_at, it1.failure_code], ['completed', 'string', null])
})

Deno.test('erro de banco 503; chamada de serviço: só POST, só com a chave do Food, JSON válido, ids válidos', async () => {
  const w = await makeWorld({ rows: { transactions: [tx(1)] } })
  w.db.failOn.push({ method: 'GET', table: 'transactions' })
  assertEquals((await call(w, handleRequest, body([T(1)]))).status, 503)
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' })).status, 405)
  for (const key of [null, 'errada']) assertEquals((await call(w, handleRequest, body([T(1)]), { key })).status, 401)
  assertEquals((await call(w, handleRequest, null, { rawBody: '{x' })).data.code, 'INVALID_BODY')
  assertEquals((await call(w, handleRequest, body([T(1)], { company_id: 'x' }))).data.code, 'INVALID_COMPANY')
})
