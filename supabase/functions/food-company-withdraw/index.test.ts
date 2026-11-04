// Roda com: deno test supabase/functions/food-company-withdraw/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  call, COMPANY_ID, CNPJ, D, EVP, foodOps, H, makeWorld, OTHER_OWNER_REF, OWNER_REF, SUB_KEY, signedOp, transfers, txs, ago, uniq, withdrawOp, withLiveWorld,
  type World,
} from '../_shared/food-test-kit.ts'
import { signFoodOp } from '../_shared/food-op.ts'
import { handleRequest, MAX_WITHDRAW_CENTS, MIN_WITHDRAW_CENTS } from './index.ts'

const body = (amount: number, extra: Record<string, unknown> = {}) => ({ company_id: COMPANY_ID, owner_ref: OWNER_REF, amount_cents: amount, ...extra })

async function withdraw(w: World, amount = 150_000, over: { op?: Awaited<ReturnType<typeof withdrawOp>>; key?: string | null; deps?: Parameters<typeof handleRequest>[1] } = {}) {
  const s = over.op ?? await withdrawOp(amount)
  return { ...(await call(w, handleRequest, body(amount, { op: s.op }), { signature: s.signature, key: over.key }, over.deps)), s }
}

// ── Caminho feliz ────────────────────────────────────────────────────────────

Deno.test('saque feliz: Pix para a chave cadastrada, lançamento com company_id e actor_ref (sem user_id), processing, sem taxa', async () => {
  const w = await makeWorld()
  const r = await withdraw(w, 150_000)
  assertEquals(r.status, 200)
  assertEquals(r.data.status, 'processing')
  assertEquals(r.data.amount_cents, 150_000)
  assertEquals(r.data.destination_masked, `${CNPJ.slice(0, 8)}***`)

  const [tx] = txs(w)
  assertEquals(txs(w).length, 1) // sem lançamento de taxa
  assertEquals(r.data.transaction_id, tx?.id)
  assertEquals([tx?.user_id, tx?.actor_ref, tx?.company_id, tx?.type, tx?.status], [null, OWNER_REF, COMPANY_ID, 'descarregar', 'processing'])
  assertEquals([tx?.amount, tx?.amount_brl, tx?.fee_amount, tx?.asaas_payment_id], [1500, 1500, 0, 'tr_1'])
  assert(!JSON.stringify(tx).includes(CNPJ)) // a chave em claro nunca vai para o lançamento

  assertEquals(transfers(w).length, 1)
  const t = transfers(w)[0]!
  assertEquals(t.key, SUB_KEY) // sempre a chave da SUBCONTA
  assertEquals(t.body, { value: 1500, pixAddressKey: CNPJ, pixAddressKeyType: 'CNPJ', description: 'Descarregamento Alber', externalReference: tx?.id })
  assertEquals(w.asaas.filter((c) => c.path === '/finance/balance').length, 1)
  assertEquals(w.pushes.length, 0) // sem usuário do app para avisar

  assertEquals(foodOps(w).length, 1)
  assertEquals(foodOps(w)[0]?.status, 'completed')
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'descarregar_initiated')
  assertEquals(audit?.user_id, null)
})

Deno.test('chave aleatória: o Asaas recebe EVP e a chave em claro; o destino mascarado não a revela inteira', async () => {
  const w = await makeWorld({ pixKey: { type: 'random', clear: EVP }, override: { pix_key_changed_at: ago(3 * D) } })
  const s = await withdrawOp(20_000, EVP)
  const r = await call(w, handleRequest, body(20_000, { op: s.op }), { signature: s.signature })
  assertEquals(r.status, 200)
  assertEquals(transfers(w)[0]?.body?.pixAddressKeyType, 'EVP')
  assertEquals(transfers(w)[0]?.body?.pixAddressKey, EVP)
  assertEquals(r.data.destination_masked, `${EVP.slice(0, 8)}...`)
})

// ── Idempotência ─────────────────────────────────────────────────────────────

Deno.test('repetir a MESMA autorização devolve o resultado original: um só Pix, um só lançamento', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000)
  const first = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  const second = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals(first.status, 200)
  assertEquals(second.status, 200)
  assertEquals(second.data, first.data)
  assertEquals(transfers(w).length, 1)
  assertEquals(txs(w).length, 1)
  assertEquals(foodOps(w).length, 1)
})

Deno.test('repetir com autorização NOVA (outro nonce) e a mesma idempotency_key: ainda um só Pix', async () => {
  const w = await makeWorld()
  const idem = uniq('idem')
  const a = await withdrawOp(150_000, CNPJ, { idempotency_key: idem })
  const b = await withdrawOp(150_000, CNPJ, { idempotency_key: idem })
  assert(a.op.nonce !== b.op.nonce)
  const first = await call(w, handleRequest, body(150_000, { op: a.op }), { signature: a.signature })
  const second = await call(w, handleRequest, body(150_000, { op: b.op }), { signature: b.signature })
  assertEquals(second.data, first.data)
  assertEquals(transfers(w).length, 1)
})

Deno.test('mesma idempotency_key com outro valor, ou nonce de outra operação reaproveitado: 403 INVALID_AUTHORIZATION e nada é pago de novo', async () => {
  const w = await makeWorld()
  const idem = uniq('idem')
  const a = await withdrawOp(150_000, CNPJ, { idempotency_key: idem })
  assertEquals((await call(w, handleRequest, body(150_000, { op: a.op }), { signature: a.signature })).status, 200)

  const otherAmount = await withdrawOp(100_000, CNPJ, { idempotency_key: idem })
  const r1 = await call(w, handleRequest, body(100_000, { op: otherAmount.op }), { signature: otherAmount.signature })
  assertEquals([r1.status, r1.data.code], [403, 'INVALID_AUTHORIZATION'])

  const reusedNonce = await withdrawOp(150_000, CNPJ, { nonce: a.op.nonce })
  const r2 = await call(w, handleRequest, body(150_000, { op: reusedNonce.op }), { signature: reusedNonce.signature })
  assertEquals([r2.status, r2.data.code], [403, 'INVALID_AUTHORIZATION'])
  assertEquals(transfers(w).length, 1)
  assertEquals(txs(w).length, 1)
})

Deno.test('dois saques ao mesmo tempo com a mesma autorização: só um paga', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000)
  const results = await withLiveWorld(w, () => Promise.all([0, 1, 2].map(() => call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature }))))
  assertEquals(transfers(w).length, 1)
  assertEquals(txs(w).length, 1)
  assert(results.every((r) => r.status === 200 || (r.status === 409 && r.data.code === 'OPERATION_IN_PROGRESS')))
  assert(results.some((r) => r.status === 200))
})

// ── Autorização assinada ─────────────────────────────────────────────────────

Deno.test('sem assinatura, assinatura errada, de outro segredo ou adulterada: 403 INVALID_AUTHORIZATION, nada é debitado nem reservado', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000)
  const cases: Array<string | null> = [null, 'v1=' + '0'.repeat(64), await signFoodOp(s.op, 'cd'.repeat(32)), 'lixo', s.signature.slice(0, -2) + '00']
  for (const signature of cases) {
    const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature })
    assertEquals([r.status, r.data.code], [403, 'INVALID_AUTHORIZATION'])
    assertEquals(r.data.message, 'Autorização da operação inválida') // não diz qual verificação falhou
  }
  assertEquals(transfers(w).length + txs(w).length + foodOps(w).length, 0)
  assert(w.db.rows('audit_logs').some((a) => a.event_type === 'food_op_rejected')) // o motivo fica só no log do servidor
})

Deno.test('op ausente ou que não é objeto: 400 MISSING_FIELDS', async () => {
  const w = await makeWorld()
  for (const op of [undefined, null, 'x', 5]) {
    const r = await call(w, handleRequest, { ...body(150_000), op })
    assertEquals([r.status, r.data.code], [400, 'MISSING_FIELDS'])
  }
})

Deno.test('autorização vencida, com vida maior que 120 s ou emitida no futuro: recusada', async () => {
  const w = await makeWorld()
  const now = Date.now()
  const iso = (ms: number) => new Date(now + ms).toISOString()
  for (const t of [
    { issued_at: iso(-90_000), expires_at: iso(-1000) }, // vencida
    { issued_at: iso(-10_000), expires_at: iso(115_000) }, // 125 s
    { issued_at: iso(300_000), expires_at: iso(360_000) }, // futuro
  ]) {
    const s = await withdrawOp(150_000, CNPJ, t)
    const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
    assertEquals([r.status, r.data.code], [403, 'INVALID_AUTHORIZATION'])
  }
  assertEquals(transfers(w).length, 0)
})

Deno.test('valor do corpo diferente do assinado, empresa ou dono diferentes, destino trocado, tipo de operação errado: 403', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000)
  // valor
  assertEquals((await call(w, handleRequest, body(150_001, { op: s.op }), { signature: s.signature })).data.code, 'INVALID_AUTHORIZATION')
  // destino: a autorização foi assinada para outra chave
  const wrongDest = await withdrawOp(150_000, '99999999000191')
  assertEquals((await call(w, handleRequest, body(150_000, { op: wrongDest.op }), { signature: wrongDest.signature })).data.code, 'INVALID_AUTHORIZATION')
  // dono dentro do op diferente do corpo
  const wrongOwner = await withdrawOp(150_000, CNPJ, { owner_ref: OTHER_OWNER_REF })
  assertEquals((await call(w, handleRequest, body(150_000, { op: wrongOwner.op }), { signature: wrongOwner.signature })).data.code, 'INVALID_AUTHORIZATION')
  // empresa dentro do op diferente do corpo
  const wrongCompany = await withdrawOp(150_000, CNPJ, { company_id: '99999999-9999-4999-8999-999999999999' })
  assertEquals((await call(w, handleRequest, body(150_000, { op: wrongCompany.op }), { signature: wrongCompany.signature })).data.code, 'INVALID_AUTHORIZATION')
  // autorização de outra operação (troca de titular) usada como saque
  const transfer = await signedOp({ kind: 'owner_transfer', new_owner_ref: OTHER_OWNER_REF })
  assertEquals((await call(w, handleRequest, body(150_000, { op: transfer.op }), { signature: transfer.signature })).data.code, 'INVALID_AUTHORIZATION')
  assertEquals(transfers(w).length + txs(w).length, 0)
})

Deno.test('chave Pix trocada depois de assinar o saque: o digest não bate mais e nada sai', async () => {
  const w = await makeWorld({ pixKey: { type: 'random', clear: EVP }, override: { pix_key_changed_at: ago(3 * D) } })
  const stale = await withdrawOp(20_000, CNPJ) // o Food assinou com a chave de antes (CNPJ); a guardada hoje é a EVP
  const r = await call(w, handleRequest, body(20_000, { op: stale.op }), { signature: stale.signature })
  assertEquals([r.status, r.data.code], [403, 'INVALID_AUTHORIZATION'])
  assertEquals(transfers(w).length, 0)
})

Deno.test('FOOD_OP_SIGNING_KEY ausente: 503 SERVICE_NOT_CONFIGURED (não saca sem poder conferir)', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000)
  const saved = Deno.env.get('FOOD_OP_SIGNING_KEY')!
  Deno.env.delete('FOOD_OP_SIGNING_KEY')
  try {
    const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
    assertEquals([r.status, r.data.code], [503, 'SERVICE_NOT_CONFIGURED'])
    assertEquals(transfers(w).length, 0)
  } finally {
    Deno.env.set('FOOD_OP_SIGNING_KEY', saved)
  }
})

// ── Chamada de serviço e empresa ─────────────────────────────────────────────

Deno.test('só POST, só com a chave do Alber Food; JSON inválido 400', async () => {
  const w = await makeWorld()
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' })).status, 405)
  for (const key of [null, 'errada', 'f'.repeat(41)]) assertEquals((await call(w, handleRequest, body(150_000), { key })).status, 401)
  assertEquals((await call(w, handleRequest, null, { rawBody: '{nao-json' })).status, 400)
  assertEquals((await call(w, handleRequest, null, { rawBody: '[1]' })).status, 400)
})

Deno.test('valor inválido: não inteiro, texto, abaixo do mínimo, acima do teto: 422 INVALID_AMOUNT', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000)
  for (const amount of [1500.5, '150000', MIN_WITHDRAW_CENTS - 1, MAX_WITHDRAW_CENTS + 1, 0, -5, null]) {
    const r = await call(w, handleRequest, { company_id: COMPANY_ID, owner_ref: OWNER_REF, amount_cents: amount, op: s.op }, { signature: s.signature })
    assertEquals([r.status, r.data.code], [422, 'INVALID_AMOUNT'])
  }
})

Deno.test('dono errado 403 NOT_OWNER; empresa inexistente ou removida 404; empresa do app (sem owner_ref) nunca é do Food', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000, CNPJ, { owner_ref: OTHER_OWNER_REF })
  const r = await call(w, handleRequest, { company_id: COMPANY_ID, owner_ref: OTHER_OWNER_REF, amount_cents: 150_000, op: s.op }, { signature: s.signature })
  assertEquals([r.status, r.data.code], [403, 'NOT_OWNER'])

  const gone = await makeWorld({ override: { deleted_at: ago(D) } })
  assertEquals((await withdraw(gone)).status, 404)
  const none = await makeWorld({ override: null })
  assertEquals((await withdraw(none)).status, 404)
  const appCompany = await makeWorld({ override: { owner_ref: null, owner_id: 'user-1', origin: 'app' } })
  assertEquals((await withdraw(appCompany)).data.code, 'NOT_OWNER')
  assertEquals(transfers(w).length + transfers(gone).length + transfers(appCompany).length, 0)
})

Deno.test('empresa sem KYC aprovado, bloqueada ou sem chave de subconta: 409 COMPANY_NOT_APPROVED', async () => {
  for (const override of [{ kyc_status: 'pending' }, { account_status: 'blocked' }, { asaas_api_key_enc: null }]) {
    const w = await makeWorld({ override })
    const r = await withdraw(w)
    assertEquals([r.status, r.data.code], [409, 'COMPANY_NOT_APPROVED'])
    assertEquals(transfers(w).length, 0)
  }
})

Deno.test('sem chave Pix de saque: 422 COMPANY_PIX_KEY_NOT_CONFIGURED', async () => {
  const w = await makeWorld({ pixKey: null })
  const s = await signedOp({ kind: 'withdraw', amount_cents: 150_000, destination_digest: 'a'.repeat(64) })
  const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [422, 'COMPANY_PIX_KEY_NOT_CONFIGURED'])
})

// ── Guarda de saque e limites ────────────────────────────────────────────────

Deno.test('vínculo em revisão ou recusado: não saca (403), e o erro fica guardado para a repetição', async () => {
  for (const [review, code] of [['pending', 'OWNER_LINK_PENDING'], ['rejected', 'OWNER_LINK_REJECTED']] as const) {
    const w = await makeWorld({ override: { owner_link_review: review } })
    const s = await withdrawOp(150_000)
    const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
    assertEquals([r.status, r.data.code], [403, code])
    assertEquals(transfers(w).length + txs(w).length, 0)
    const again = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
    assertEquals([again.status, again.data.code], [403, code]) // mesmo desfecho
    assertEquals(foodOps(w)[0]?.status, 'failed')
  }
  const legacy = await makeWorld({ override: { owner_link_review: 'legacy' } })
  assertEquals((await withdraw(legacy)).status, 200) // legacy não bloqueia
})

Deno.test('chave aleatória cadastrada há menos de 48 h: 403 PIX_KEY_RECENTLY_CHANGED com available_at; depois de 48 h, saca', async () => {
  const w = await makeWorld({ pixKey: { type: 'random', clear: EVP }, override: { pix_key_changed_at: ago(10 * H) } })
  const s = await withdrawOp(20_000, EVP)
  const r = await call(w, handleRequest, body(20_000, { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [403, 'PIX_KEY_RECENTLY_CHANGED'])
  assertEquals(typeof r.data.available_at, 'string')
  assert(new Date(r.data.available_at as string).getTime() > Date.now())
  assertEquals(transfers(w).length, 0)

  const later = await makeWorld({ pixKey: { type: 'random', clear: EVP }, override: { pix_key_changed_at: ago(49 * H) } })
  const s2 = await withdrawOp(20_000, EVP)
  assertEquals((await call(later, handleRequest, body(20_000, { op: s2.op }), { signature: s2.signature })).status, 200)
})

Deno.test('limite por saque e diário (empresa nova e madura), contando saques do app e do Food e ignorando os que falharam', async () => {
  // Empresa nova (30 dias): R$ 1.000 por saque, R$ 2.000 por dia.
  const novo = await makeWorld({ override: { kyc_approved_at: ago(5 * D) } })
  const r1 = await withdraw(novo, 100_001) // R$ 1.000,01
  assertEquals([r1.status, r1.data.code, r1.data.limit_brl], [422, 'WITHDRAW_LIMIT_PER_TX', 1000])

  // Madura: R$ 5.000 por saque, R$ 20.000 por dia; já saiu R$ 16.000 hoje (um do app, um do Food, um falho que não conta).
  const maduro = await makeWorld({
    rows: {
      transactions: [
        { id: 't1', company_id: COMPANY_ID, user_id: 'u1', type: 'transferir_enviado', amount: 6000, status: 'completed', created_at: ago(2 * H) },
        { id: 't2', company_id: COMPANY_ID, user_id: null, actor_ref: OWNER_REF, type: 'descarregar', amount: 10000, status: 'processing', created_at: ago(3 * H) },
        { id: 't3', company_id: COMPANY_ID, user_id: null, actor_ref: OWNER_REF, type: 'descarregar', amount: 9000, status: 'failed', created_at: ago(1 * H) },
        { id: 't4', company_id: COMPANY_ID, user_id: null, actor_ref: OWNER_REF, type: 'descarregar', amount: 9000, status: 'completed', created_at: ago(30 * H) }, // fora das 24 h
      ],
    },
  })
  maduro.balance = 50_000
  const r2 = await withdraw(maduro, 500_001)
  assertEquals([r2.status, r2.data.code], [422, 'WITHDRAW_LIMIT_PER_TX'])
  const r3 = await withdraw(maduro, 500_000) // 16.000 + 5.000 = 21.000 > 20.000
  assertEquals([r3.status, r3.data.code, r3.data.limit_brl], [422, 'WITHDRAW_LIMIT_DAILY', 20000])
  const r4 = await withdraw(maduro, 400_000) // 20.000 exatos: passa
  assertEquals(r4.status, 200)
  assertEquals(transfers(maduro).length, 1)
})

Deno.test('limite aprovado pela equipe substitui o padrão (os dois juntos)', async () => {
  const w = await makeWorld({ override: { withdraw_limit_per_tx_brl: '20000.00', withdraw_limit_per_day_brl: '60000.00' } })
  w.balance = 30_000
  assertEquals((await withdraw(w, 1_500_000)).status, 200) // R$ 15.000 por saque
  const r = await withdraw(w, 2_100_000) // R$ 21.000 > 20.000 por saque
  assertEquals([r.status, r.data.code, r.data.limit_brl], [422, 'WITHDRAW_LIMIT_PER_TX', 20000])
})

Deno.test('falha ao ler a guarda: 503 WITHDRAW_CHECK_FAILED, nada sai, e a MESMA autorização pode tentar de novo', async () => {
  const w = await makeWorld()
  const s = await withdrawOp(150_000)
  w.db.failOn.push({ method: 'GET', table: 'transactions' })
  const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [503, 'WITHDRAW_CHECK_FAILED'])
  assertEquals(transfers(w).length, 0)
  assertEquals(foodOps(w).length, 0) // reserva desfeita: falha passageira, nada aconteceu

  w.db.failOn = []
  const retry = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals(retry.status, 200)
  assertEquals(transfers(w).length, 1)
})

Deno.test('saldo insuficiente: 422, sem lançamento nem Pix; a repetição devolve o mesmo erro', async () => {
  const w = await makeWorld()
  w.balance = 100
  const s = await withdrawOp(150_000)
  const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [422, 'INSUFFICIENT_BALANCE'])
  assertEquals(txs(w).length + transfers(w).length, 0)
  w.balance = 99_999 // mesmo com saldo agora, a mesma operação já foi encerrada com este desfecho
  const again = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals([again.status, again.data.code], [422, 'INSUFFICIENT_BALANCE'])
  assertEquals(transfers(w).length, 0)
})

Deno.test('saldo igual ao valor passa; saldo indisponível no Asaas: 503 e a mesma autorização pode tentar de novo', async () => {
  const w = await makeWorld()
  w.balance = 1500
  assertEquals((await withdraw(w, 150_000)).status, 200)

  const down = await makeWorld()
  down.asaasOverride = (c) => (c.path.startsWith('/finance/balance') ? new Response('{"errors":[]}', { status: 500 }) : null)
  const s = await withdrawOp(150_000)
  const r = await call(down, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [503, 'ASAAS_ERROR'])
  assertEquals(foodOps(down).length, 0)
})

// ── Corrida entre saques ─────────────────────────────────────────────────────

Deno.test('dois saques diferentes ao mesmo tempo que juntos estourariam o limite do dia: não passam os dois', async () => {
  // Limite aprovado R$ 1.000 por saque e R$ 1.500 por dia; dois saques de R$ 1.000 simultâneos.
  const w = await makeWorld({ override: { withdraw_limit_per_tx_brl: '1000.00', withdraw_limit_per_day_brl: '1500.00' } })
  const a = await withdrawOp(100_000)
  const b = await withdrawOp(100_000)
  const [ra, rb] = await withLiveWorld(w, () => Promise.all([
    call(w, handleRequest, body(100_000, { op: a.op }), { signature: a.signature }),
    call(w, handleRequest, body(100_000, { op: b.op }), { signature: b.signature }),
  ]))
  assert(transfers(w).length <= 1, `saiu ${transfers(w).length} Pix`)
  assert([ra, rb].some((r) => r.status === 422 && r.data.code === 'WITHDRAW_LIMIT_DAILY'))
  const live = txs(w).filter((t) => t.status !== 'failed')
  assert(live.reduce((s, t) => s + Number(t.amount), 0) <= 1500)
})

// ── Falhas do Asaas ──────────────────────────────────────────────────────────

Deno.test('Asaas recusa o Pix: 503, lançamento failed, e a repetição devolve o erro sem tentar de novo', async () => {
  const w = await makeWorld()
  w.asaasOverride = (c) => (c.path === '/transfers' ? new Response(JSON.stringify({ errors: [{ description: 'chave inválida' }] }), { status: 400 }) : null)
  const s = await withdrawOp(150_000)
  const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [503, 'ASAAS_ERROR'])
  assert(!JSON.stringify(r.data).includes('chave inválida'))
  assertEquals(txs(w).map((t) => t.status), ['failed'])
  const again = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals(again.data.code, 'ASAAS_ERROR')
  assertEquals(transfers(w).length, 1)
})

Deno.test('Pix sem resposta (rede caiu): desfecho desconhecido; lançamento fica pending, operação em andamento e repetir NÃO paga de novo', async () => {
  const w = await makeWorld()
  w.networkDown.push('/transfers')
  const s = await withdrawOp(150_000)
  const r = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals([r.status, r.data.code], [503, 'ASAAS_ERROR'])
  assertEquals(txs(w).map((t) => t.status), ['pending'])
  assertEquals(foodOps(w)[0]?.status, 'in_progress')

  w.networkDown = []
  const again = await call(w, handleRequest, body(150_000, { op: s.op }), { signature: s.signature })
  assertEquals([again.status, again.data.code], [409, 'OPERATION_IN_PROGRESS'])
  const fresh = await withdrawOp(150_000, CNPJ, { idempotency_key: s.op.idempotency_key })
  const withNewNonce = await call(w, handleRequest, body(150_000, { op: fresh.op }), { signature: fresh.signature })
  assertEquals(withNewNonce.data.code, 'OPERATION_IN_PROGRESS')
  assertEquals(transfers(w).length, 1) // só a primeira tentativa chegou ao Asaas
})

// ── Taxa (decisão pendente: desligada) ───────────────────────────────────────

Deno.test('taxa desligada por padrão: o valor inteiro sai e não há lançamento de taxa', async () => {
  const w = await makeWorld()
  assertEquals((await withdraw(w, 150_000)).status, 200)
  assertEquals(transfers(w)[0]?.body?.value, 1500)
  assertEquals(txs(w).filter((t) => t.type === 'fee').length, 0)
})

Deno.test('com a taxa ligada (ponto único): sai valor - taxa, lançamento de taxa completo e repasse à conta pai', async () => {
  const w = await makeWorld()
  Deno.env.set('ASAAS_PARENT_WALLET_ID', 'wallet_parent')
  try {
    const r = await withdraw(w, 150_000, { deps: { feeBrl: async () => 30 } })
    assertEquals(r.status, 200)
    assertEquals(r.data.amount_cents, 150_000)
    const sent = transfers(w)
    assertEquals(sent[0]?.body?.value, 1470) // pix líquido
    assertEquals(sent[1]?.body?.walletId, 'wallet_parent') // taxa para a conta pai
    assertEquals(sent[1]?.body?.value, 30)
    const fee = txs(w).find((t) => t.type === 'fee')
    assertEquals([fee?.status, fee?.amount, fee?.user_id, fee?.actor_ref, fee?.reference_type], ['completed', 30, null, OWNER_REF, 'descarregar'])
    assertEquals(txs(w).find((t) => t.type === 'descarregar')?.fee_amount, 30)
  } finally {
    Deno.env.delete('ASAAS_PARENT_WALLET_ID')
  }
})

// ── Webhook de conclusão ─────────────────────────────────────────────────────

Deno.test('o webhook TRANSFER_DONE do Asaas conclui o saque do Food (user_id nulo) sem enviar push', async () => {
  const w = await makeWorld()
  const r = await withdraw(w, 150_000)
  assertEquals(r.status, 200)
  const { handleRequest: webhook } = await import('../webhooks-asaas-pix/index.ts')
  Deno.env.set('ASAAS_WEBHOOK_SECRET', 'webhook-secret-test')
  const hook = new Request('http://localhost/hook', {
    method: 'POST', headers: { 'asaas-access-token': 'webhook-secret-test', 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'TRANSFER_DONE', transfer: { id: 'tr_1', status: 'DONE', value: 1500 } }),
  })
  const res = await call(w, (_req: Request) => webhook(hook), {}, {})
  assertEquals(res.status, 200)
  assertEquals(txs(w)[0]?.status, 'completed')
  assertEquals(w.pushes.length, 0)
  assertEquals(w.db.rows('audit_logs').find((a) => a.event_type === 'descarregar_completed')?.user_id, null)
})
