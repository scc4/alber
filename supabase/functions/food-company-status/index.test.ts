// Roda com: deno test supabase/functions/food-company-status/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { ago, call, CNPJ, COMPANY_ID, D, EVP, H, makeWorld, OTHER_OWNER_REF, OWNER_REF, SUB_KEY } from '../_shared/food-test-kit.ts'
import { destinationDigest } from '../_shared/food-op.ts'
import { handleRequest } from './index.ts'

const body = { company_id: COMPANY_ID, owner_ref: OWNER_REF }
const withdrawOf = (data: Record<string, unknown>) => data.withdraw as Record<string, unknown>
const pixOf = (data: Record<string, unknown>) => data.pix_key as Record<string, unknown>

Deno.test('empresa aprovada com chave do CNPJ: tudo o que o Food precisa mostrar, e o saque liberado', async () => {
  const w = await makeWorld()
  const r = await call(w, handleRequest, body)
  assertEquals(r.status, 200)
  assertEquals(Object.keys(r.data).sort(), ['account_status', 'company_id', 'handle', 'kyc_status', 'last_limit_request', 'limits', 'onboarding_url', 'owner_link_check', 'owner_link_review', 'pix_key', 'withdraw'])
  assertEquals([r.data.company_id, r.data.handle, r.data.kyc_status, r.data.account_status, r.data.onboarding_url, r.data.owner_link_check, r.data.owner_link_review], [COMPANY_ID, 'meurestaurante', 'approved', 'active', null, 'match', 'not_needed'])
  const pix = pixOf(r.data)
  assertEquals([pix.configured, pix.type, pix.masked, pix.digest, pix.available_at], [true, 'cnpj', `${CNPJ.slice(0, 8)}***`, await destinationDigest(COMPANY_ID, CNPJ), null])
  assertEquals(typeof pix.changed_at, 'string')
  assertEquals(r.data.limits, { per_tx_brl: 5000, per_day_brl: 20000, source: 'default' })
  assertEquals(r.data.last_limit_request, null)
  assertEquals(r.data.withdraw, { allowed: true, code: null, message: null })
  assertEquals(w.asaas.length, 0) // aprovada: não consulta o Asaas
})

Deno.test('nunca devolve a chave Pix em claro, o CNPJ, a chave da subconta nem campos internos', async () => {
  const w = await makeWorld({ override: { asaas_deposit_key: 'segredo' } })
  const text = JSON.stringify((await call(w, handleRequest, body)).data)
  for (const secret of [CNPJ, SUB_KEY, 'asaas_api_key_enc', 'asaas_deposit_key', 'owner_id', 'segredo']) assert(!text.includes(secret), `vazou ${secret}`)
})

Deno.test('chave aleatória: máscara, digest, quando foi cadastrada e quando os saques voltam', async () => {
  const changed = ago(10 * H)
  const w = await makeWorld({ pixKey: { type: 'random', clear: EVP }, override: { pix_key_changed_at: changed, pix_key_set_at: changed } })
  const r = await call(w, handleRequest, body)
  const pix = pixOf(r.data)
  assertEquals([pix.type, pix.masked, pix.digest, pix.changed_at], ['random', `${EVP.slice(0, 8)}...`, await destinationDigest(COMPANY_ID, EVP), changed])
  assertEquals(pix.available_at, new Date(new Date(changed).getTime() + 48 * H).toISOString())
  assertEquals(withdrawOf(r.data).code, 'PIX_KEY_RECENTLY_CHANGED')
  assertEquals(withdrawOf(r.data).allowed, false)
})

Deno.test('limites: padrão de empresa nova, aprovado pela equipe, e o último pedido de aumento', async () => {
  const novo = await makeWorld({ override: { kyc_approved_at: ago(3 * D) } })
  assertEquals((await call(novo, handleRequest, body)).data.limits, { per_tx_brl: 1000, per_day_brl: 2000, source: 'default' })

  const w = await makeWorld({
    override: { withdraw_limit_per_tx_brl: '8000.00', withdraw_limit_per_day_brl: '30000.00' },
    rows: {
      company_limit_requests: [
        { id: 'r1', company_id: COMPANY_ID, status: 'rejected', requested_per_tx_brl: '6000.00', requested_per_day_brl: '25000.00', approved_per_tx_brl: null, approved_per_day_brl: null, created_at: ago(10 * D), decided_at: ago(9 * D) },
        { id: 'r2', company_id: COMPANY_ID, status: 'approved', requested_per_tx_brl: '8000.00', requested_per_day_brl: '30000.00', approved_per_tx_brl: '8000.00', approved_per_day_brl: '30000.00', created_at: ago(2 * D), decided_at: ago(1 * D) },
        { id: 'other', company_id: 'outra-empresa', status: 'pending', requested_per_tx_brl: '1.00', requested_per_day_brl: '1.00', created_at: ago(1 * H), decided_at: null },
      ],
    },
  })
  const r = await call(w, handleRequest, body)
  assertEquals(r.data.limits, { per_tx_brl: 8000, per_day_brl: 30000, source: 'approved' })
  const last = r.data.last_limit_request as Record<string, unknown>
  assertEquals([last.id, last.status, last.requested_per_tx_brl, last.approved_per_tx_brl, last.approved_per_day_brl], ['r2', 'approved', 8000, 8000, 30000])
})

Deno.test('pré-checagem do saque, na ordem em que food-company-withdraw recusaria: aprovação, chave, vínculo, carência', async () => {
  const cases: Array<[Record<string, unknown>, Parameters<typeof makeWorld>[0], string]> = [
    [{ kyc_status: 'pending', owner_link_review: 'pending' }, {}, 'COMPANY_NOT_APPROVED'],
    [{ account_status: 'blocked' }, {}, 'COMPANY_NOT_APPROVED'],
    [{}, { pixKey: null }, 'COMPANY_PIX_KEY_NOT_CONFIGURED'],
    [{ owner_link_review: 'pending' }, {}, 'OWNER_LINK_PENDING'],
    [{ owner_link_review: 'rejected' }, {}, 'OWNER_LINK_REJECTED'],
  ]
  for (const [override, opts, code] of cases) {
    // KYC pendente consulta o Asaas: o Asaas "não aprova" para a empresa seguir pendente
    const w = await makeWorld({ ...opts, override })
    w.asaasOverride = (c) => (c.path.startsWith('/myAccount/status') ? new Response('{"general":"PENDING"}', { status: 200 }) : null)
    const r = await call(w, handleRequest, body)
    assertEquals([r.status, withdrawOf(r.data).allowed, withdrawOf(r.data).code], [200, false, code])
    assertEquals(typeof withdrawOf(r.data).message, 'string')
  }
})

Deno.test('empresa pendente: consulta o Asaas com a chave da SUBCONTA e, se aprovada, grava a aprovação sem push (dono sem usuário)', async () => {
  const w = await makeWorld({ override: { kyc_status: 'pending', account_status: 'evaluation', kyc_approved_at: null, asaas_deposit_key: null, owner_link_review: 'not_needed' } })
  const r = await call(w, handleRequest, body)
  assertEquals(r.status, 200)
  assertEquals([r.data.kyc_status], ['approved'])
  const c = w.db.rows('companies')[0]!
  assertEquals(c.kyc_status, 'approved')
  assertEquals(typeof c.kyc_approved_at, 'string')
  assertEquals(typeof c.asaas_deposit_key, 'string') // chave Pix de recebimento criada na aprovação
  const status = w.asaas.find((a) => a.path.startsWith('/myAccount/status'))
  assertEquals(status?.key, SUB_KEY)
  assertEquals(w.pushes.length, 0)
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'company_kyc_status_approved')
  assertEquals(audit?.user_id, null)
  // recém-aprovada = empresa nova: limites de 30 dias
  assertEquals((r.data.limits as Record<string, unknown>).per_tx_brl, 1000)
})

Deno.test('empresa pendente que o Asaas ainda não aprovou, ou consulta que falha: segue pendente, sem erro', async () => {
  for (const respond of [() => new Response('{"general":"PENDING"}', { status: 200 }), () => new Response('{}', { status: 500 })]) {
    const w = await makeWorld({ override: { kyc_status: 'pending', kyc_approved_at: null } })
    w.asaasOverride = (c) => (c.path.startsWith('/myAccount/status') ? respond() : null)
    const r = await call(w, handleRequest, body)
    assertEquals([r.status, r.data.kyc_status], [200, 'pending'])
    assertEquals(w.db.rows('companies')[0]?.kyc_status, 'pending')
  }
})

Deno.test('dono errado 403 NOT_OWNER; inexistente, removida ou empresa do app: 404 / 403; ids inválidos 422', async () => {
  const w = await makeWorld()
  assertEquals((await call(w, handleRequest, { ...body, owner_ref: OTHER_OWNER_REF })).data.code, 'NOT_OWNER')
  assertEquals((await call(w, handleRequest, { ...body, owner_ref: '' })).data.code, 'INVALID_OWNER')
  assertEquals((await call(w, handleRequest, { ...body, company_id: 'x' })).data.code, 'INVALID_COMPANY')
  assertEquals((await call(await makeWorld({ override: null }), handleRequest, body)).status, 404)
  assertEquals((await call(await makeWorld({ override: { deleted_at: ago(D) } }), handleRequest, body)).status, 404)
  assertEquals((await call(await makeWorld({ override: { owner_ref: null, owner_id: 'u1', origin: 'app' } }), handleRequest, body)).data.code, 'NOT_OWNER')
})

Deno.test('chamada de serviço: só POST, só com a chave do Food, JSON válido', async () => {
  const w = await makeWorld()
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' })).status, 405)
  for (const key of [null, 'errada']) assertEquals((await call(w, handleRequest, body, { key })).status, 401)
  assertEquals((await call(w, handleRequest, null, { rawBody: '{x' })).data.code, 'INVALID_BODY')
  const saved = Deno.env.get('ALBER_FOOD_SERVICE_KEY')!
  Deno.env.delete('ALBER_FOOD_SERVICE_KEY')
  try {
    assertEquals((await call(w, handleRequest, body)).status, 503) // sem o segredo configurado, recusa tudo
  } finally {
    Deno.env.set('ALBER_FOOD_SERVICE_KEY', saved)
  }
})
