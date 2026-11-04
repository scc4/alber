// Roda com: deno test supabase/functions/food-company-set-pix-key/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  call, CNPJ, COMPANY_ID, EVP, foodOps, makeWorld, OTHER_OWNER_REF, OWNER_REF, SUB_KEY, signedOp, withLiveWorld, type World,
} from '../_shared/food-test-kit.ts'
import { destinationDigest, type FoodOp } from '../_shared/food-op.ts'
import type { ExternalPixKeyLookup } from '../_shared/asaas.ts'
import { sha256hex, aesDecrypt } from '../_shared/crypto.ts'
import { handleRequest } from './index.ts'

const setKey = async (key: string, fields: Partial<FoodOp> = {}) => await signedOp({ kind: 'set_pix_key', destination_digest: await destinationDigest(COMPANY_ID, key), ...fields })
const company = (w: World) => w.db.rows('companies')[0]!
const body = (keyType: unknown, extra: Record<string, unknown> = {}) => ({ company_id: COMPANY_ID, owner_ref: OWNER_REF, key_type: keyType, cnpj: CNPJ, ...extra })

// Fake da consulta do Asaas: registra as chamadas e devolve o que o teste manda.
function lookup(result: ExternalPixKeyLookup | (() => never)) {
  const calls: Array<{ evp: string; key: string }> = []
  return {
    calls,
    deps: {
      lookupPixKey: (evp: string, key: string) => {
        calls.push({ evp, key })
        return Promise.resolve(typeof result === 'function' ? result() : result)
      },
    },
  }
}
const owned: ExternalPixKeyLookup = { kind: 'found', ownerDocument: CNPJ }

Deno.test('chave do CNPJ: grava cifrada, sem espera de 48 h e sem consultar o Asaas; devolve máscara e digest', async () => {
  const w = await makeWorld({ pixKey: null })
  const l = lookup(owned)
  const s = await setKey(CNPJ)
  const r = await call(w, handleRequest, body('cnpj', { cnpj: '11.222.333/0001-81', op: s.op }), { signature: s.signature }, l.deps)
  assertEquals(r.status, 200)
  const view = r.data.pix_key as Record<string, unknown>
  assertEquals([view.configured, view.type, view.masked, view.digest, view.available_at], [true, 'cnpj', `${CNPJ.slice(0, 8)}***`, await destinationDigest(COMPANY_ID, CNPJ), null])
  const c = company(w)
  assertEquals([c.pix_key_type, c.pix_key_hash, c.pix_key_changed_at], ['cnpj', await sha256hex(CNPJ), null])
  assertEquals(await aesDecrypt(c.pix_key as string, Deno.env.get('ENCRYPTION_KEY')!), CNPJ)
  assertEquals(l.calls.length + w.asaas.length, 0)
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'company_pix_key_changed')
  assertEquals([audit?.user_id, (audit?.metadata as Record<string, unknown>).owner_ref], [null, OWNER_REF])
  assert(!JSON.stringify(r.data).includes(CNPJ))
})

Deno.test('chave aleatória do CNPJ: consulta com a chave da SUBCONTA, grava em minúsculas e começa a espera de 48 h', async () => {
  const w = await makeWorld({ pixKey: null })
  const l = lookup({ kind: 'found', ownerDocument: '11.222.333/0001-81' })
  const s = await setKey(EVP)
  const r = await call(w, handleRequest, body('random', { pix_key: EVP.toUpperCase(), op: s.op }), { signature: s.signature }, l.deps)
  assertEquals(r.status, 200)
  assertEquals(l.calls, [{ evp: EVP, key: SUB_KEY }])
  const view = r.data.pix_key as Record<string, unknown>
  assertEquals([view.type, view.masked, view.digest], ['random', `${EVP.slice(0, 8)}...`, await destinationDigest(COMPANY_ID, EVP)])
  const wait = new Date(view.available_at as string).getTime() - Date.now()
  assert(wait > 47.9 * 3_600_000 && wait <= 48 * 3_600_000)
  assertEquals(await aesDecrypt(company(w).pix_key as string, Deno.env.get('ENCRYPTION_KEY')!), EVP)
  assertEquals(company(w).pix_key_hash, await sha256hex(EVP))
  assertEquals(w.asaas.filter((a) => a.path === '/pix/addressKeys').length, 0) // nunca gera chave nova
})

Deno.test('chave aleatória: dono com outro documento 422 PIX_KEY_OWNER_MISMATCH, resposta sem dados de terceiro, nada gravado', async () => {
  const w = await makeWorld({ pixKey: null })
  const l = lookup({ kind: 'found', ownerDocument: '99.888.777/0001-66' })
  const s = await setKey(EVP)
  const r = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, l.deps)
  assertEquals([r.status, r.data.code], [422, 'PIX_KEY_OWNER_MISMATCH'])
  assert(!JSON.stringify(r.data).includes('99888777'))
  assertEquals(company(w).pix_key, null)
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'company_pix_key_rejected')
  assertEquals([audit?.user_id, audit?.metadata], [null, { company_id: COMPANY_ID, via: 'food', owner_ref: OWNER_REF, reason: 'owner_mismatch' }])
  assert(!JSON.stringify(w.db.rows('audit_logs')).includes('99888777'))
  // o erro fica guardado: repetir devolve o mesmo, sem nova consulta
  const again = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, l.deps)
  assertEquals(again.data.code, 'PIX_KEY_OWNER_MISMATCH')
  assertEquals(l.calls.length, 1)
})

Deno.test('chave aleatória não encontrada: 422 PIX_KEY_NOT_FOUND', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey(EVP)
  const r = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, lookup({ kind: 'not_found' }).deps)
  assertEquals([r.status, r.data.code], [422, 'PIX_KEY_NOT_FOUND'])
  assertEquals(company(w).pix_key, null)
})

Deno.test('documento mascarado ou incompleto: 503 PIX_KEY_VERIFICATION_UNAVAILABLE com retryable false (nunca aceita)', async () => {
  for (const doc of ['***.222.333/0001-**', '**.***.***/0001-81', '11222333', '52998224725']) {
    const w = await makeWorld({ pixKey: null })
    const s = await setKey(EVP)
    const r = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, lookup({ kind: 'found', ownerDocument: doc }).deps)
    assertEquals([r.status, r.data.code, r.data.retryable], [503, 'PIX_KEY_VERIFICATION_UNAVAILABLE', false], doc)
    assert(String(r.data.message).includes('CNPJ'))
    assertEquals(company(w).pix_key, null)
    assertEquals(foodOps(w)[0]?.status, 'failed') // terminal: repetir não adianta
  }
})

Deno.test('rede, 5xx, 429 ou exceção na consulta: 503 retryable true, nada gravado e a MESMA autorização pode tentar de novo', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey(EVP)
  for (const down of [lookup({ kind: 'unavailable', retryable: true }), lookup(() => { throw new Error('rede') })]) {
    const r = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, down.deps)
    assertEquals([r.status, r.data.code, r.data.retryable], [503, 'PIX_KEY_VERIFICATION_UNAVAILABLE', true])
    assertEquals(company(w).pix_key, null)
    assertEquals(foodOps(w).length, 0)
  }
  const ok = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, lookup(owned).deps)
  assertEquals(ok.status, 200)
})

Deno.test('consulta real ao Asaas (sem fake): 404 não encontrada, 429/500 retryable, 400 sem retry, documento mascarado, documento completo', async () => {
  const run = async (respond: () => Response) => {
    const w = await makeWorld({ pixKey: null })
    w.asaasOverride = (c) => (c.path.startsWith('/pix/addressKeys/external') ? respond() : null)
    const s = await setKey(EVP)
    const r = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature })
    return { r, w }
  }
  const j = (b: unknown, status: number) => () => new Response(JSON.stringify(b), { status })
  assertEquals((await run(j({}, 404))).r.data.code, 'PIX_KEY_NOT_FOUND')
  for (const st of [429, 500, 503]) assertEquals((await run(j({}, st))).r.data.retryable, true, String(st))
  assertEquals((await run(j({}, 400))).r.data.retryable, false)
  assertEquals((await run(j({ owner: { name: 'X' } }, 200))).r.data.retryable, false) // sem documento
  assertEquals((await run(j({ owner: { name: 'X', cpfCnpj: '***.222.333/0001-**' } }, 200))).r.data.retryable, false)
  const good = await run(j({ owner: { name: 'RESTAURANTE', cpfCnpj: CNPJ } }, 200))
  assertEquals(good.r.status, 200)
  const call0 = good.w.asaas.find((a) => a.path.startsWith('/pix/addressKeys/external'))!
  assertEquals([call0.method, call0.key, call0.body, call0.path], ['GET', SUB_KEY, null, `/pix/addressKeys/external?type=EVP&key=${EVP}`])
})

Deno.test('campos: cnpj obrigatório nos dois tipos; pix_key obrigatório para random e proibido para cnpj', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey(CNPJ)
  const send = (extra: Record<string, unknown>, kt: string = 'cnpj') => call(w, handleRequest, body(kt, { op: s.op, ...extra }), { signature: s.signature }, lookup(owned).deps)
  assertEquals((await send({ cnpj: undefined })).data.code, 'CNPJ_INVALID')
  assertEquals((await send({ cnpj: undefined }, 'random')).data.code, 'MISSING_FIELDS') // random sem pix_key vem antes
  assertEquals((await send({ cnpj: undefined, pix_key: EVP }, 'random')).data.code, 'CNPJ_INVALID')
  assertEquals((await send({ cnpj: '11444777000161' })).data.code, 'CNPJ_MISMATCH')
  assertEquals((await send({ cnpj: '11444777000161', pix_key: EVP }, 'random')).data.code, 'CNPJ_MISMATCH')
  assertEquals((await send({}, 'random')).data.code, 'MISSING_FIELDS')
  const withKey = await send({ pix_key: EVP })
  assertEquals([withKey.status, withKey.data.code], [400, 'INVALID_BODY'])
  for (const pix_key of ['nao-e-uuid', 12345, '']) assertEquals((await send({ pix_key }, 'random')).data.code, pix_key === '' ? 'PIX_KEY_INVALID' : 'PIX_KEY_INVALID')
  assertEquals(company(w).pix_key, null)
  assertEquals(foodOps(w).length, 0)
})

Deno.test('a autorização tem de trazer o digest da chave: sem digest, de outra chave, de outro tipo, de outro dono, vencida ou sem assinatura: 403 e nada consultado nem gravado', async () => {
  const w = await makeWorld({ pixKey: null })
  const l = lookup(owned)
  const send = (s: Awaited<ReturnType<typeof signedOp>>, extra: Record<string, unknown> = {}) =>
    call(w, handleRequest, body('random', { pix_key: EVP, op: s.op, ...extra }), { signature: s.signature }, l.deps)
  const noDigest = await signedOp({ kind: 'set_pix_key' })
  const wrongKey = await setKey('0f1e2d3c-4b5a-4968-8776-655443322111')
  const asWithdraw = await signedOp({ kind: 'withdraw', amount_cents: 1500, destination_digest: await destinationDigest(COMPANY_ID, EVP) })
  const wrongOwner = await setKey(EVP, { owner_ref: OTHER_OWNER_REF })
  const expired = await setKey(EVP, { issued_at: new Date(Date.now() - 100_000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() })
  for (const s of [noDigest, wrongKey, asWithdraw, wrongOwner, expired]) assertEquals((await send(s)).data.code, 'INVALID_AUTHORIZATION')
  const ok = await setKey(EVP)
  assertEquals((await call(w, handleRequest, body('random', { pix_key: EVP, op: ok.op }), {}, l.deps)).data.code, 'INVALID_AUTHORIZATION')
  assertEquals(company(w).pix_key, null)
  assertEquals(l.calls.length, 0) // a consulta só acontece depois da autorização e da reserva
})

Deno.test('a chave só é gravada UMA vez: 409 PIX_KEY_EXISTS e sem consulta ao Asaas', async () => {
  const w = await makeWorld() // já tem chave CNPJ
  const l = lookup(owned)
  const s = await setKey(EVP)
  const r = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, l.deps)
  assertEquals([r.status, r.data.code], [409, 'PIX_KEY_EXISTS'])
  assertEquals([company(w).pix_key_type, l.calls.length], ['cnpj', 0])
})

Deno.test('duas chamadas ao mesmo tempo (autorizações diferentes): só uma grava, a outra recebe PIX_KEY_EXISTS', async () => {
  const w = await makeWorld({ pixKey: null })
  const a = await setKey(CNPJ)
  const b = await setKey(EVP)
  const l = lookup(owned)
  const [ra, rb] = await withLiveWorld(w, () => Promise.all([
    call(w, handleRequest, body('cnpj', { op: a.op }), { signature: a.signature }, l.deps),
    call(w, handleRequest, body('random', { pix_key: EVP, op: b.op }), { signature: b.signature }, l.deps),
  ]))
  assertEquals([ra.status, rb.status].sort(), [200, 409])
  assertEquals([ra, rb].find((r) => r.status === 409)?.data.code, 'PIX_KEY_EXISTS')
})

Deno.test('repetir a mesma autorização devolve a resposta original, sem nova consulta nem nova gravação', async () => {
  const w = await makeWorld({ pixKey: null })
  const l = lookup(owned)
  const s = await setKey(EVP)
  const first = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, l.deps)
  const again = await call(w, handleRequest, body('random', { pix_key: EVP, op: s.op }), { signature: s.signature }, l.deps)
  assertEquals([first.status, again.status, again.data], [200, 200, first.data])
  assertEquals(l.calls.length, 1)
  assertEquals(foodOps(w).length, 1)
})

Deno.test('chamada de serviço: só POST, só com a chave do Food, key_type e op obrigatórios, dono e empresa conferidos, empresa aprovada', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await setKey(CNPJ)
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' })).status, 405)
  assertEquals((await call(w, handleRequest, body('cnpj', { op: s.op }), { key: null })).status, 401)
  assertEquals((await call(w, handleRequest, body('cpf', { op: s.op }), { signature: s.signature })).data.code, 'INVALID_KEY_TYPE')
  assertEquals((await call(w, handleRequest, body('cnpj'), {})).data.code, 'MISSING_FIELDS')
  const notOwner = await call(w, handleRequest, { ...body('cnpj', { op: s.op }), owner_ref: OTHER_OWNER_REF }, { signature: s.signature })
  assertEquals([notOwner.status, notOwner.data.code], [403, 'NOT_OWNER'])
  assertEquals((await call(w, handleRequest, { ...body('cnpj', { op: s.op }), company_id: 'x' }, { signature: s.signature })).data.code, 'INVALID_COMPANY')
  const pending = await makeWorld({ pixKey: null, override: { kyc_status: 'pending' } })
  const r = await call(pending, handleRequest, body('cnpj', { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [409, 'COMPANY_NOT_APPROVED'])
})
