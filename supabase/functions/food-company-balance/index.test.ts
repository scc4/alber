// Roda com: deno test supabase/functions/food-company-balance/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { ago, call, COMPANY_ID, D, makeWorld, OTHER_OWNER_REF, OWNER_REF, SUB_KEY } from '../_shared/food-test-kit.ts'
import { handleRequest } from './index.ts'

const body = { company_id: COMPANY_ID, owner_ref: OWNER_REF }

Deno.test('devolve o saldo em centavos lido com a chave da SUBCONTA (nunca a da conta pai)', async () => {
  const w = await makeWorld()
  w.balance = 77.5
  const r = await call(w, handleRequest, body)
  assertEquals(r.status, 200)
  assertEquals(r.data.balance_cents, 7750)
  assertEquals(Number.isNaN(Date.parse(r.data.generated_at as string)), false)
  assert(w.asaas.length === 1 && w.asaas[0]?.key === SUB_KEY)
  assertEquals(w.db.log.filter((l) => l.method !== 'GET').length, 0) // somente leitura
})

Deno.test('saldo com centavos quebrados é arredondado, e saldo zero é zero', async () => {
  const w = await makeWorld()
  w.balance = 0.1 + 0.2
  assertEquals((await call(w, handleRequest, body)).data.balance_cents, 30)
  w.balance = 0
  assertEquals((await call(w, handleRequest, body)).data.balance_cents, 0)
})

Deno.test('dono errado 403; empresa inexistente, removida 404; sem KYC aprovado, bloqueada ou sem chave 409: nenhuma consulta ao Asaas', async () => {
  const bad = [
    [await makeWorld({ override: null }), 404],
    [await makeWorld({ override: { deleted_at: ago(D) } }), 404],
    [await makeWorld({ override: { kyc_status: 'pending' } }), 409],
    [await makeWorld({ override: { account_status: 'blocked' } }), 409],
    [await makeWorld({ override: { asaas_api_key_enc: null } }), 409],
  ] as const
  for (const [w, status] of bad) {
    assertEquals((await call(w, handleRequest, body)).status, status)
    assertEquals(w.asaas.length, 0)
  }
  const w = await makeWorld()
  const r = await call(w, handleRequest, { ...body, owner_ref: OTHER_OWNER_REF })
  assertEquals([r.status, r.data.code, w.asaas.length], [403, 'NOT_OWNER', 0])
})

Deno.test('falha do Asaas: 502 genérico, sem detalhe do provedor', async () => {
  const w = await makeWorld()
  w.asaasOverride = () => new Response(JSON.stringify({ errors: [{ description: 'segredo interno' }] }), { status: 500 })
  const r = await call(w, handleRequest, body)
  assertEquals([r.status, r.data.code], [502, 'BALANCE_PROVIDER_ERROR'])
  assert(!JSON.stringify(r.data).includes('segredo interno'))
})

Deno.test('chamada de serviço: só POST, só com a chave do Food, ids válidos', async () => {
  const w = await makeWorld()
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' })).status, 405)
  for (const key of [null, 'errada', 'f'.repeat(41)]) assertEquals((await call(w, handleRequest, body, { key })).status, 401)
  assertEquals((await call(w, handleRequest, { company_id: 'x', owner_ref: OWNER_REF })).data.code, 'INVALID_COMPANY')
  assertEquals((await call(w, handleRequest, { company_id: COMPANY_ID })).data.code, 'INVALID_OWNER')
  assertEquals((await call(w, handleRequest, null, { rawBody: 'não é json' })).data.code, 'INVALID_BODY')
})
