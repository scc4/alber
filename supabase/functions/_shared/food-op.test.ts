// Roda com: deno test supabase/functions/_shared/food-op.test.ts --allow-env --allow-net
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  canonicalJson, destinationDigest, finishFoodOp, parseSigningKey, reserveFoodOp, signFoodOp, verifyFoodOp,
  type FoodOp, type FoodOpExpectation, type FoodOpRejection,
} from './food-op.ts'
import { FakeDb, installFakeFetch } from './fake-postgrest.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SECRET = 'c0ffee'.repeat(11).slice(0, 64) // hexadecimal de 64 caracteres = 32 bytes
const NOW = new Date('2026-11-10T12:00:00.000Z')
const COMPANY = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const NEW_OWNER = '33333333-3333-4333-8333-333333333333'
const KEY = '5b2f6a1e-9f1d-4a7e-8f55-0d1c5d9e7a11'

const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
let counter = 0
const nonce = () => `nonce-${String(++counter).padStart(12, '0')}`

async function digestOf() {
  return await destinationDigest(COMPANY, KEY)
}

async function withdrawOp(over: Record<string, unknown> = {}): Promise<FoodOp> {
  return {
    kind: 'withdraw', company_id: COMPANY, owner_ref: OWNER, amount_cents: 150_000, destination_digest: await digestOf(),
    nonce: nonce(), issued_at: iso(-5_000), expires_at: iso(60_000), idempotency_key: `idem-${nonce()}`, ...over,
  } as FoodOp
}

async function expectWithdraw(over: Partial<FoodOpExpectation> = {}): Promise<FoodOpExpectation> {
  return { kind: 'withdraw', companyId: COMPANY, ownerRef: OWNER, amountCents: 150_000, destinationDigest: await digestOf(), ...over }
}

const headersWith = (sig: string | null) => new Headers(sig === null ? {} : { 'x-food-op-signature': sig })

async function verdict(op: unknown, expected: FoodOpExpectation, sig?: string | null, now = NOW, secret: string | null = SECRET) {
  const signature = sig === undefined ? await signFoodOp(op, SECRET) : sig
  return await verifyFoodOp(headersWith(signature), op, expected, now, secret)
}
const reason = (v: Awaited<ReturnType<typeof verdict>>): FoodOpRejection | 'OK' => (v.ok ? 'OK' : v.reason)

// ── JSON canônico e segredo ──────────────────────────────────────────────────

Deno.test('JSON canônico: chaves em ordem alfabética, recursivo, sem espaços; undefined some; arrays mantêm a ordem', () => {
  assertEquals(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: 'é"x' }, z: undefined, n: null }), '{"a":{"c":"é\\"x","d":[3,{"x":2,"y":1}]},"b":1,"n":null}')
  assertEquals(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }))
})

Deno.test('segredo: hexadecimal de 64+, base64 de 32+ bytes; curto, vazio e lixo são inválidos', () => {
  assertEquals(parseSigningKey(SECRET)?.length, 32)
  assertEquals(parseSigningKey('ab'.repeat(40))?.length, 40)
  assertEquals(parseSigningKey(btoa('x'.repeat(32)))?.length, 32)
  assertEquals(parseSigningKey(btoa('x'.repeat(31))), null)
  assertEquals(parseSigningKey('abcd'), null)
  assertEquals(parseSigningKey(''), null)
  assertEquals(parseSigningKey(undefined), null)
  assertEquals(parseSigningKey('!!! não é base64 !!!'), null)
})

Deno.test('a assinatura independe da ordem das chaves do objeto enviado', async () => {
  const op = await withdrawOp()
  const shuffled = Object.fromEntries(Object.entries(op).reverse())
  assertEquals(await signFoodOp(op, SECRET), await signFoodOp(shuffled, SECRET))
  assertEquals(reason(await verifyFoodOp(headersWith(await signFoodOp(op, SECRET)), shuffled, await expectWithdraw(), NOW, SECRET)), 'OK')
})

// ── Caminho feliz dos três tipos ─────────────────────────────────────────────

Deno.test('saque, chave Pix (com e sem chave no corpo) e troca de titular: autorização válida passa', async () => {
  assertEquals(reason(await verdict(await withdrawOp(), await expectWithdraw())), 'OK')

  const setKey = { kind: 'set_pix_key', company_id: COMPANY, owner_ref: OWNER, destination_digest: await digestOf(), nonce: nonce(), issued_at: iso(-1000), expires_at: iso(100_000), idempotency_key: 'idem-set-key-1' }
  assertEquals(reason(await verdict(setKey, { kind: 'set_pix_key', companyId: COMPANY, ownerRef: OWNER, destinationDigest: await digestOf() })), 'OK')

  const generated = { kind: 'set_pix_key', company_id: COMPANY, owner_ref: OWNER, nonce: nonce(), issued_at: iso(-1000), expires_at: iso(100_000), idempotency_key: 'idem-set-key-2' }
  assertEquals(reason(await verdict(generated, { kind: 'set_pix_key', companyId: COMPANY, ownerRef: OWNER, destinationDigest: null })), 'OK')

  const transfer = { kind: 'owner_transfer', company_id: COMPANY, owner_ref: OWNER, new_owner_ref: NEW_OWNER, nonce: nonce(), issued_at: iso(0), expires_at: iso(120_000), idempotency_key: 'idem-transfer-1' }
  assertEquals(reason(await verdict(transfer, { kind: 'owner_transfer', companyId: COMPANY, ownerRef: OWNER, newOwnerRef: NEW_OWNER })), 'OK') // 120 s exatos: no limite
})

// ── Cabeçalho e assinatura ───────────────────────────────────────────────────

Deno.test('cabeçalho ausente, malformado ou de outra versão é recusado', async () => {
  const op = await withdrawOp()
  const exp = await expectWithdraw()
  assertEquals(reason(await verdict(op, exp, null)), 'missing_signature')
  const good = await signFoodOp(op, SECRET)
  for (const bad of ['', 'v2=' + good.slice(3), good.slice(3), good.slice(0, -2), good + '0', 'v1= ' + good.slice(3), 'v1=zz' + good.slice(5)]) {
    const r = reason(await verdict(op, exp, bad))
    assert(r === 'bad_signature_format' || r === 'missing_signature', `cabeçalho "${bad}" deveria cair no formato (deu ${r})`)
  }
})

Deno.test('assinatura em maiúsculas vale; assinatura de outro segredo, de outro objeto ou adulterada não', async () => {
  const op = await withdrawOp()
  const exp = await expectWithdraw()
  const good = await signFoodOp(op, SECRET)
  assertEquals(reason(await verdict(op, exp, 'v1=' + good.slice(3).toUpperCase())), 'OK')
  assertEquals(reason(await verdict(op, exp, await signFoodOp(op, '0123456789abcdef'.repeat(4)))), 'bad_signature')
  assertEquals(reason(await verdict(op, exp, await signFoodOp({ ...op, nonce: nonce() }, SECRET))), 'bad_signature')
  const flipped = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0')
  assertEquals(reason(await verdict(op, exp, flipped)), 'bad_signature')
})

Deno.test('adulteração de qualquer campo depois de assinado quebra a assinatura (valor, destino, empresa, dono, validade, chave de idempotência)', async () => {
  const op = await withdrawOp()
  const sig = await signFoodOp(op, SECRET)
  const exp = await expectWithdraw()
  const tampered: Array<Record<string, unknown>> = [
    { ...op, amount_cents: 1 },
    { ...op, destination_digest: 'a'.repeat(64) },
    { ...op, company_id: '99999999-9999-4999-8999-999999999999' },
    { ...op, owner_ref: 'outro' },
    { ...op, expires_at: iso(110_000) },
    { ...op, idempotency_key: 'outra-chave-xyz' },
    { ...op, extra: true },
  ]
  for (const t of tampered) assertEquals(reason(await verdict(t, exp, sig)), 'bad_signature')
})

Deno.test('sem FOOD_OP_SIGNING_KEY válida (ausente, curta) a verificação não roda: not_configured', async () => {
  const op = await withdrawOp()
  const exp = await expectWithdraw()
  const sig = await signFoodOp(op, SECRET)
  for (const secret of [null, '', 'curta', 'ab'.repeat(20)]) assertEquals(reason(await verdict(op, exp, sig, NOW, secret)), 'not_configured')
})

// ── Validade ─────────────────────────────────────────────────────────────────

Deno.test('vencida, com vida acima de 120 s, com vida zero ou negativa, emitida no futuro: recusada', async () => {
  const exp = await expectWithdraw()
  assertEquals(reason(await verdict(await withdrawOp({ expires_at: iso(0) }), exp)), 'expired') // vence neste instante
  assertEquals(reason(await verdict(await withdrawOp({ issued_at: iso(-150_000), expires_at: iso(-60_000) }), exp)), 'expired')
  assertEquals(reason(await verdict(await withdrawOp({ issued_at: iso(-10_000), expires_at: iso(111_000) }), exp)), 'ttl') // 121 s
  assertEquals(reason(await verdict(await withdrawOp({ issued_at: iso(1000), expires_at: iso(1000) }), exp)), 'ttl')
  assertEquals(reason(await verdict(await withdrawOp({ issued_at: iso(5000), expires_at: iso(1000) }), exp)), 'ttl')
  assertEquals(reason(await verdict(await withdrawOp({ issued_at: iso(61_000), expires_at: iso(100_000) }), exp)), 'not_yet_valid')
  assertEquals(reason(await verdict(await withdrawOp({ issued_at: iso(30_000), expires_at: iso(100_000) }), exp)), 'OK') // dentro da tolerância de relógio
})

Deno.test('datas fora do formato ISO são recusadas', async () => {
  const exp = await expectWithdraw()
  for (const bad of ['2026-11-10', 'ontem', '1762776000', '2026-11-10 12:00:00']) {
    assertEquals(reason(await verdict(await withdrawOp({ expires_at: bad }), exp)), 'malformed')
  }
})

// ── Amarração ao corpo e ao que o Alber guarda ───────────────────────────────

Deno.test('tipo, empresa, dono, valor e destino diferentes do esperado: recusada', async () => {
  const op = await withdrawOp()
  assertEquals(reason(await verdict(op, await expectWithdraw({ kind: 'set_pix_key' }))), 'kind')
  assertEquals(reason(await verdict(op, await expectWithdraw({ companyId: '99999999-9999-4999-8999-999999999999' }))), 'company')
  assertEquals(reason(await verdict(op, await expectWithdraw({ ownerRef: 'outro-dono' }))), 'owner')
  assertEquals(reason(await verdict(op, await expectWithdraw({ amountCents: 150_001 }))), 'amount')
  assertEquals(reason(await verdict(op, await expectWithdraw({ amountCents: undefined }))), 'amount')
  assertEquals(reason(await verdict(op, await expectWithdraw({ destinationDigest: await destinationDigest(COMPANY, 'outra-chave') }))), 'destination')
  assertEquals(reason(await verdict(op, await expectWithdraw({ destinationDigest: null }))), 'destination')
  assertEquals(reason(await verdict(op, await expectWithdraw({ destinationDigest: undefined }))), 'destination')
})

Deno.test('digest do destino amarra a empresa: a mesma chave em outra empresa dá outro digest', async () => {
  const a = await destinationDigest(COMPANY, KEY)
  const b = await destinationDigest('99999999-9999-4999-8999-999999999999', KEY)
  assert(a !== b && /^[0-9a-f]{64}$/.test(a))
})

Deno.test('chave Pix: digest da chave do corpo tem de bater; autorização com digest quando o Alber gera a chave é recusada; troca de titular exige o novo dono', async () => {
  const withDigest = { kind: 'set_pix_key', company_id: COMPANY, owner_ref: OWNER, destination_digest: await digestOf(), nonce: nonce(), issued_at: iso(0), expires_at: iso(60_000), idempotency_key: 'idem-key-aaaa' }
  const other = await destinationDigest(COMPANY, 'outra')
  assertEquals(reason(await verdict(withDigest, { kind: 'set_pix_key', companyId: COMPANY, ownerRef: OWNER, destinationDigest: other })), 'destination')
  assertEquals(reason(await verdict(withDigest, { kind: 'set_pix_key', companyId: COMPANY, ownerRef: OWNER, destinationDigest: null })), 'destination')
  const noDigest = { ...withDigest, destination_digest: undefined, nonce: nonce() }
  assertEquals(reason(await verdict(noDigest, { kind: 'set_pix_key', companyId: COMPANY, ownerRef: OWNER, destinationDigest: await digestOf() })), 'destination')

  const transfer = { kind: 'owner_transfer', company_id: COMPANY, owner_ref: OWNER, new_owner_ref: NEW_OWNER, nonce: nonce(), issued_at: iso(0), expires_at: iso(60_000), idempotency_key: 'idem-transfer-9' }
  assertEquals(reason(await verdict(transfer, { kind: 'owner_transfer', companyId: COMPANY, ownerRef: OWNER, newOwnerRef: 'outro-novo-dono' })), 'new_owner')
  assertEquals(reason(await verdict(transfer, { kind: 'owner_transfer', companyId: COMPANY, ownerRef: OWNER })), 'new_owner')
})

Deno.test('formato do op: campo desconhecido, nonce curto, chave de idempotência curta, valor não inteiro, campo de outro tipo: recusado', async () => {
  const exp = await expectWithdraw()
  assertEquals(reason(await verdict(await withdrawOp({ foo: 1 }), exp)), 'unknown_field')
  assertEquals(reason(await verdict(await withdrawOp({ nonce: 'curto' }), exp)), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ nonce: 'tem espaço no nonce!' }), exp)), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ idempotency_key: 'curta' }), exp)), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ idempotency_key: 'x'.repeat(65) }), exp)), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ amount_cents: 1500.5 }), await expectWithdraw({ amountCents: 1500 }))), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ amount_cents: '150000' }), exp)), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ amount_cents: 0 }), await expectWithdraw({ amountCents: 0 }))), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ kind: 'transfer' }), exp)), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ company_id: 'nao-uuid' }), exp)), 'malformed')
  assertEquals(reason(await verdict(await withdrawOp({ new_owner_ref: NEW_OWNER }), exp)), 'malformed') // saque com campo de troca de titular
  const noAmount = await withdrawOp()
  delete (noAmount as { amount_cents?: number }).amount_cents
  assertEquals(reason(await verdict(noAmount, exp)), 'malformed')
  for (const notObject of [null, 'op', 7, [1, 2]]) assertEquals(reason(await verdict(notObject, exp)), 'malformed')
})

// ── Armazém: nonce e idempotência ────────────────────────────────────────────

function store() {
  const db = new FakeDb()
  db.unique.food_ops = [{ cols: ['nonce'] }, { cols: ['idempotency_key'] }]
  const restore = installFakeFetch(db)
  const admin = createClient('https://supabase.test', 'service')
  return { db, admin, restore }
}

Deno.test('operação nova reserva; repetir a MESMA autorização antes do fim dá in_progress; depois do fim devolve o desfecho guardado', async () => {
  const { db, admin, restore } = store()
  try {
    const op = await withdrawOp()
    const first = await reserveFoodOp(admin, op, NOW)
    assertEquals(first.kind, 'new')
    assertEquals(db.rows('food_ops').length, 1)
    assertEquals((await reserveFoodOp(admin, op, NOW)).kind, 'in_progress')

    const ok = { ok: true as const, status: 200, body: { transaction_id: 't1' } }
    assert(first.kind === 'new' && await finishFoodOp(admin, first.id, ok))
    const replay = await reserveFoodOp(admin, op, NOW)
    assertEquals(replay, { kind: 'replay', result: ok })
    assertEquals(db.rows('food_ops').length, 1)
  } finally { restore() }
})

Deno.test('repetição com autorização NOVA (nonce novo) mas a mesma idempotency_key e o mesmo conteúdo devolve o original, sem nova linha', async () => {
  const { db, admin, restore } = store()
  try {
    const op = await withdrawOp()
    const first = await reserveFoodOp(admin, op, NOW)
    assert(first.kind === 'new')
    const done = { ok: true as const, status: 200, body: { transaction_id: 't1' } }
    await finishFoodOp(admin, first.id, done)
    const again = await reserveFoodOp(admin, { ...op, nonce: nonce(), issued_at: iso(30_000), expires_at: iso(90_000) }, NOW)
    assertEquals(again, { kind: 'replay', result: done })
    assertEquals(db.rows('food_ops').length, 1)
  } finally { restore() }
})

Deno.test('desfecho de falha também é devolvido na repetição (sem novo débito)', async () => {
  const { admin, restore } = store()
  try {
    const op = await withdrawOp()
    const r = await reserveFoodOp(admin, op, NOW)
    assert(r.kind === 'new')
    const failed = { ok: false as const, status: 403, code: 'OWNER_LINK_PENDING', message: 'x' }
    await finishFoodOp(admin, r.id, failed)
    assertEquals(await reserveFoodOp(admin, op, NOW), { kind: 'replay', result: failed })
  } finally { restore() }
})

Deno.test('nonce já usado por OUTRA operação, e idempotency_key reaproveitada com outro valor ou destino: conflito', async () => {
  const { admin, restore } = store()
  try {
    const op = await withdrawOp()
    assertEquals((await reserveFoodOp(admin, op, NOW)).kind, 'new')
    // mesmo nonce, outra chave de idempotência
    assertEquals((await reserveFoodOp(admin, { ...op, idempotency_key: 'idem-outra-chave-1' }, NOW)).kind, 'conflict')
    // mesma chave, outro valor
    assertEquals((await reserveFoodOp(admin, { ...op, nonce: nonce(), amount_cents: 1 }, NOW)).kind, 'conflict')
    // mesma chave, outro destino
    assertEquals((await reserveFoodOp(admin, { ...op, nonce: nonce(), destination_digest: 'b'.repeat(64) }, NOW)).kind, 'conflict')
    // mesma chave, outra empresa
    assertEquals((await reserveFoodOp(admin, { ...op, nonce: nonce(), company_id: '99999999-9999-4999-8999-999999999999' }, NOW)).kind, 'conflict')
    // mesma chave, outro tipo
    assertEquals((await reserveFoodOp(admin, { kind: 'set_pix_key', company_id: COMPANY, owner_ref: OWNER, nonce: nonce(), issued_at: op.issued_at, expires_at: op.expires_at, idempotency_key: op.idempotency_key }, NOW)).kind, 'conflict')
  } finally { restore() }
})

Deno.test('duas chamadas ao mesmo tempo com a mesma chave: só uma é nova', async () => {
  const { db, admin, restore } = store()
  try {
    const op = await withdrawOp()
    const results = await Promise.all([reserveFoodOp(admin, op, NOW), reserveFoodOp(admin, { ...op, nonce: nonce() }, NOW), reserveFoodOp(admin, op, NOW)])
    assertEquals(results.filter((r) => r.kind === 'new').length, 1)
    assert(results.every((r) => r.kind === 'new' || r.kind === 'in_progress'))
    assertEquals(db.rows('food_ops').length, 1)
  } finally { restore() }
})

Deno.test('falha passageira (retryable) desfaz a reserva: a mesma operação pode tentar de novo', async () => {
  const { db, admin, restore } = store()
  try {
    const op = await withdrawOp()
    const r = await reserveFoodOp(admin, op, NOW)
    assert(r.kind === 'new')
    await finishFoodOp(admin, r.id, { ok: false, status: 503, code: 'WITHDRAW_CHECK_FAILED', message: 'x', retryable: true })
    assertEquals(db.rows('food_ops').length, 0)
    assertEquals((await reserveFoodOp(admin, op, NOW)).kind, 'new')
  } finally { restore() }
})

Deno.test('banco indisponível: error (na dúvida, não opera)', async () => {
  const { db, admin, restore } = store()
  try {
    db.failOn.push({ method: 'GET', table: 'food_ops' })
    assertEquals((await reserveFoodOp(admin, await withdrawOp(), NOW)).kind, 'error')
    db.failOn = [{ method: 'POST', table: 'food_ops' }]
    assertEquals((await reserveFoodOp(admin, await withdrawOp(), NOW)).kind, 'error')
  } finally { restore() }
})

Deno.test('limpeza: operações encerradas e vencidas saem; as em andamento ficam', async () => {
  const { db, admin, restore } = store()
  try {
    const past = new Date(NOW.getTime() - 86_400_000).toISOString()
    db.rows('food_ops').push(
      { id: 'a', nonce: 'n-old-completed-0001', idempotency_key: 'k-old-completed', status: 'completed', expires_at: past },
      { id: 'b', nonce: 'n-old-progress-0001', idempotency_key: 'k-old-progress', status: 'in_progress', expires_at: past },
      { id: 'c', nonce: 'n-fresh-completed-01', idempotency_key: 'k-fresh-completed', status: 'completed', expires_at: new Date(NOW.getTime() + 86_400_000).toISOString() },
    )
    await reserveFoodOp(admin, await withdrawOp(), NOW)
    assertEquals(db.rows('food_ops').map((r) => r.id).filter((id) => ['a', 'b', 'c'].includes(String(id))).sort(), ['b', 'c'])
  } finally { restore() }
})
