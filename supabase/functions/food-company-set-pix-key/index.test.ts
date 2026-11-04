// Roda com: deno test supabase/functions/food-company-set-pix-key/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  call, CNPJ, COMPANY_ID, EVP, foodOps, makeWorld, OTHER_OWNER_REF, OWNER_REF, SUB_KEY, signedOp, withLiveWorld, type World,
} from '../_shared/food-test-kit.ts'
import { destinationDigest, type FoodOp } from '../_shared/food-op.ts'
import { sha256hex, aesDecrypt } from '../_shared/crypto.ts'
import { handleRequest } from './index.ts'

const setKey = async (fields: Partial<FoodOp> = {}) => await signedOp({ kind: 'set_pix_key', ...fields })
const keyCreations = (w: World) => w.asaas.filter((c) => c.method === 'POST' && c.path === '/pix/addressKeys')
const company = (w: World) => w.db.rows('companies')[0]!
const body = (keyType: unknown, extra: Record<string, unknown> = {}) => ({ company_id: COMPANY_ID, owner_ref: OWNER_REF, key_type: keyType, ...extra })

Deno.test('chave do tipo CNPJ: grava cifrada, sem espera de 48 h, devolve máscara e digest para o Food assinar saques', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, CNPJ) })
  const r = await call(w, handleRequest, body('cnpj', { cnpj: '11.222.333/0001-81', op: s.op }), { signature: s.signature })
  assertEquals(r.status, 200)
  const view = r.data.pix_key as Record<string, unknown>
  assertEquals([view.configured, view.type, view.masked, view.digest, view.available_at], [true, 'cnpj', `${CNPJ.slice(0, 8)}***`, await destinationDigest(COMPANY_ID, CNPJ), null])
  assertEquals(typeof view.changed_at, 'string')

  const c = company(w)
  assertEquals([c.pix_key_type, c.pix_key_hash, c.pix_key_changed_at], ['cnpj', await sha256hex(CNPJ), null])
  assertEquals(await aesDecrypt(c.pix_key as string, Deno.env.get('ENCRYPTION_KEY')!), CNPJ)
  assert(typeof c.pix_key_set_at === 'string')
  assertEquals(keyCreations(w).length, 0)
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'company_pix_key_changed')
  assertEquals(audit?.user_id, null)
  assertEquals((audit?.metadata as Record<string, unknown>).owner_ref, OWNER_REF)
  assertEquals(w.pushes.length, 0)
  assert(!JSON.stringify(r.data).includes(CNPJ)) // a chave em claro nunca volta
})

Deno.test('chave aleatória colada pelo dono: começa a espera de 48 h (available_at) e o digest amarra a autorização à chave', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, EVP) })
  const r = await call(w, handleRequest, body('random', { pix_key: EVP.toUpperCase(), op: s.op }), { signature: s.signature })
  assertEquals(r.status, 200)
  const view = r.data.pix_key as Record<string, unknown>
  assertEquals([view.type, view.masked, view.digest], ['random', `${EVP.slice(0, 8)}...`, await destinationDigest(COMPANY_ID, EVP)])
  const wait = new Date(view.available_at as string).getTime() - Date.now()
  assert(wait > 47.9 * 3_600_000 && wait <= 48 * 3_600_000, `espera de ${wait} ms`)
  assertEquals(typeof company(w).pix_key_changed_at, 'string')
  assertEquals(await aesDecrypt(company(w).pix_key as string, Deno.env.get('ENCRYPTION_KEY')!), EVP) // guardada em minúsculas
  assertEquals(keyCreations(w).length, 0)
})

Deno.test('chave aleatória sem pix_key no corpo: o Alber registra uma EVP nova na subconta (chave da SUBCONTA) e a autorização não pode trazer digest', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey()
  const r = await call(w, handleRequest, body('random', { op: s.op }), { signature: s.signature })
  assertEquals(r.status, 200)
  assertEquals(keyCreations(w).length, 1)
  assertEquals(keyCreations(w)[0]?.key, SUB_KEY)
  assertEquals(keyCreations(w)[0]?.body, { type: 'EVP' })
  assertEquals((r.data.pix_key as Record<string, unknown>).masked, `${EVP.slice(0, 8)}...`)
  assertEquals((w.db.rows('audit_logs').find((a) => a.event_type === 'company_pix_key_changed')?.metadata as Record<string, unknown>).generated, true)

  const w2 = await makeWorld({ pixKey: null })
  const withDigest = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, EVP) })
  const bad = await call(w2, handleRequest, body('random', { op: withDigest.op }), { signature: withDigest.signature })
  assertEquals([bad.status, bad.data.code], [403, 'INVALID_AUTHORIZATION'])
  assertEquals(keyCreations(w2).length, 0)
})

Deno.test('a chave só é gravada UMA vez: 409 PIX_KEY_EXISTS (com autorização válida), a chave de antes não muda', async () => {
  const w = await makeWorld() // já tem chave CNPJ
  const s = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, EVP) })
  const r = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [409, 'PIX_KEY_EXISTS'])
  assertEquals(company(w).pix_key_type, 'cnpj')
  assertEquals(keyCreations(w).length, 0)
  // sem autorização válida nem se sabe o estado: 403
  const unsigned = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), {})
  assertEquals(unsigned.data.code, 'INVALID_AUTHORIZATION')
})

Deno.test('duas chamadas ao mesmo tempo (autorizações diferentes): só uma grava, a outra recebe PIX_KEY_EXISTS', async () => {
  const w = await makeWorld({ pixKey: null })
  const a = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, CNPJ) })
  const b = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, EVP) })
  const [ra, rb] = await withLiveWorld(w, () => Promise.all([
    call(w, handleRequest, body('cnpj', { cnpj: CNPJ, op: a.op }), { signature: a.signature }),
    call(w, handleRequest, body('random', { pix_key: EVP, op: b.op }), { signature: b.signature }),
  ]))
  assertEquals([ra.status, rb.status].sort(), [200, 409])
  assertEquals([ra, rb].find((r) => r.status === 409)?.data.code, 'PIX_KEY_EXISTS')
})

Deno.test('repetir a mesma autorização devolve a resposta original e não registra outra chave na subconta', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey()
  const first = await call(w, handleRequest, body('random', { op: s.op }), { signature: s.signature })
  const again = await call(w, handleRequest, body('random', { op: s.op }), { signature: s.signature })
  assertEquals(first.status, 200)
  assertEquals([again.status, again.data], [200, first.data])
  assertEquals(keyCreations(w).length, 1)
  assertEquals(w.db.rows('audit_logs').filter((a) => a.event_type === 'company_pix_key_changed').length, 1)
  assertEquals(foodOps(w).length, 1)
})

Deno.test('falha do Asaas ao gerar a EVP: 503, nada gravado, autorização liberada para nova tentativa', async () => {
  const w = await makeWorld({ pixKey: null })
  w.asaasOverride = (c) => (c.path === '/pix/addressKeys' ? new Response('{"errors":[]}', { status: 500 }) : null)
  const s = await setKey()
  const r = await call(w, handleRequest, body('random', { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [503, 'ASAAS_ERROR'])
  assertEquals(company(w).pix_key, null)
  assertEquals(foodOps(w).length, 0)
  w.asaasOverride = undefined
  assertEquals((await call(w, handleRequest, body('random', { op: s.op }), { signature: s.signature })).status, 200)
})

Deno.test('CNPJ que não bate com o da empresa 422 CNPJ_MISMATCH; inválido ou ausente 422; EVP malformada 422', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey({ destination_digest: 'a'.repeat(64) })
  const mismatch = await call(w, handleRequest, body('cnpj', { cnpj: '11444777000161', op: s.op }), { signature: s.signature })
  assertEquals([mismatch.status, mismatch.data.code], [422, 'CNPJ_MISMATCH'])
  for (const cnpj of ['123', undefined, '11111111111111']) assertEquals((await call(w, handleRequest, body('cnpj', { cnpj, op: s.op }), { signature: s.signature })).data.code, 'CNPJ_INVALID')
  for (const pix_key of ['nao-e-uuid', 12345, '']) assertEquals((await call(w, handleRequest, body('random', { pix_key, op: s.op }), { signature: s.signature })).data.code, 'PIX_KEY_INVALID')
  assertEquals(company(w).pix_key, null)
})

Deno.test('autorização que aponta para OUTRA chave, de outro tipo, de outro dono, vencida ou sem assinatura: 403 e nada é gravado', async () => {
  const w = await makeWorld({ pixKey: null })
  const wrongKey = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, '99999999000191') })
  assertEquals((await call(w, handleRequest, body('cnpj', { cnpj: CNPJ, op: wrongKey.op }), { signature: wrongKey.signature })).data.code, 'INVALID_AUTHORIZATION')
  const asWithdraw = await signedOp({ kind: 'withdraw', amount_cents: 1500, destination_digest: await destinationDigest(COMPANY_ID, CNPJ) })
  assertEquals((await call(w, handleRequest, body('cnpj', { cnpj: CNPJ, op: asWithdraw.op }), { signature: asWithdraw.signature })).data.code, 'INVALID_AUTHORIZATION')
  const wrongOwner = await setKey({ owner_ref: OTHER_OWNER_REF, destination_digest: await destinationDigest(COMPANY_ID, CNPJ) })
  assertEquals((await call(w, handleRequest, body('cnpj', { cnpj: CNPJ, op: wrongOwner.op }), { signature: wrongOwner.signature })).data.code, 'INVALID_AUTHORIZATION')
  const expired = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, CNPJ), issued_at: new Date(Date.now() - 100_000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() })
  assertEquals((await call(w, handleRequest, body('cnpj', { cnpj: CNPJ, op: expired.op }), { signature: expired.signature })).data.code, 'INVALID_AUTHORIZATION')
  const ok = await setKey({ destination_digest: await destinationDigest(COMPANY_ID, CNPJ) })
  assertEquals((await call(w, handleRequest, body('cnpj', { cnpj: CNPJ, op: ok.op }), {})).data.code, 'INVALID_AUTHORIZATION')
  assertEquals(company(w).pix_key, null)
})

Deno.test('chamada de serviço: só POST, só com a chave do Food, key_type e op obrigatórios, dono e empresa conferidos, empresa aprovada', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey()
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' })).status, 405)
  assertEquals((await call(w, handleRequest, body('random', { op: s.op }), { key: null })).status, 401)
  assertEquals((await call(w, handleRequest, body('cpf', { op: s.op }), { signature: s.signature })).data.code, 'INVALID_KEY_TYPE')
  assertEquals((await call(w, handleRequest, body('random'), {})).data.code, 'MISSING_FIELDS')
  const notOwner = await call(w, handleRequest, { ...body('random', { op: s.op }), owner_ref: OTHER_OWNER_REF }, { signature: s.signature })
  assertEquals([notOwner.status, notOwner.data.code], [403, 'NOT_OWNER'])
  assertEquals((await call(w, handleRequest, { ...body('random', { op: s.op }), company_id: 'x' }, { signature: s.signature })).data.code, 'INVALID_COMPANY')
  const pending = await makeWorld({ pixKey: null, override: { kyc_status: 'pending' } })
  const r = await call(pending, handleRequest, body('random', { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [409, 'COMPANY_NOT_APPROVED'])
})
