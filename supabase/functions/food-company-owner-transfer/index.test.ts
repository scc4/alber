// Roda com: deno test supabase/functions/food-company-owner-transfer/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  ago, call, CNPJ, COMPANY_ID, CPF, D, EVP, foodOps, makeWorld, OTHER_OWNER_REF, OWNER_REF, signedOp, transfers, withdrawOp, withLiveWorld, type World,
} from '../_shared/food-test-kit.ts'
import type { FoodOp } from '../_shared/food-op.ts'
import type { CnpjRegistry } from '../_shared/owner-link.ts'
import { handleRequest as setPixKey } from '../food-company-set-pix-key/index.ts'
import { handleRequest as withdraw } from '../food-company-withdraw/index.ts'
import { handleRequest as status } from '../food-company-status/index.ts'
import { handleRequest } from './index.ts'

// CPF 529.982.247-25: dígitos 4 a 9 = 982247.
const registry = (partnerMask: string, role = 'Sócio-Administrador'): CnpjRegistry => ({ situation: 'ATIVA', legalName: 'RESTAURANTE LTDA', partners: [{ name: 'FULANO', cpfMask: partnerMask, role }] })
const MATCH = async () => registry('***982247**')
const OTHER_PARTNER = async () => registry('***111111**')

const transferOp = async (fields: Partial<FoodOp> = {}) => await signedOp({ kind: 'owner_transfer', new_owner_ref: OTHER_OWNER_REF, ...fields })
const body = (extra: Record<string, unknown> = {}) => ({
  company_id: COMPANY_ID, from_owner_ref: OWNER_REF, to_owner_ref: OTHER_OWNER_REF, new_owner: { cpf: CPF, name: 'Maria Souza', phone: '11988887777' }, cnpj: CNPJ, ...extra,
})
const company = (w: World) => w.db.rows('companies')[0]!

async function transfer(w: World, over: { extra?: Record<string, unknown>; op?: Awaited<ReturnType<typeof transferOp>>; registry?: () => Promise<CnpjRegistry | null> } = {}) {
  const s = over.op ?? await transferOp()
  const calls: string[] = []
  const reg = over.registry ?? MATCH
  const r = await call(w, handleRequest, body({ op: s.op, ...over.extra }), { signature: s.signature }, { registry: (cnpj: string) => { calls.push(cnpj); return reg() } })
  return { ...r, s, registryCalls: calls }
}

Deno.test('troca de titular: owner_ref novo, vínculo refeito para o novo dono, chave Pix zerada e espera de 48 h reiniciada', async () => {
  const w = await makeWorld({ override: { owner_link_review: 'approved', owner_link_check: 'partner', owner_link_reviewed_at: ago(D) } })
  const before = Date.now()
  const r = await transfer(w)
  assertEquals(r.status, 200)
  assertEquals([r.data.owner_link_check, r.data.owner_link_review, r.data.pix_key_reset], ['match', 'not_needed', true])
  const wait = new Date(r.data.withdraw_available_at as string).getTime() - before
  assert(wait > 47.9 * 3_600_000 && wait < 48.1 * 3_600_000, `espera de ${wait} ms`)
  assertEquals(r.registryCalls, [CNPJ]) // a consulta usa o CNPJ em claro vindo do corpo

  const c = company(w)
  assertEquals([c.owner_ref, c.owner_link_check, c.owner_link_review, c.owner_link_qualification, c.owner_link_reviewed_at], [OTHER_OWNER_REF, 'match', 'not_needed', 'Sócio-Administrador', null])
  assertEquals([c.pix_key, c.pix_key_type, c.pix_key_hash, c.pix_key_set_at], [null, null, null, null])
  assertEquals(typeof c.pix_key_changed_at, 'string')
  assertEquals(c.owner_id, null)
  assert(!JSON.stringify(w.db.log).includes(CPF)) // o CPF do novo dono não é gravado em lugar nenhum
  const audit = w.db.rows('audit_logs').find((a) => a.event_type === 'company_owner_transferred')
  assertEquals([audit?.user_id, (audit?.metadata as Record<string, unknown>).from_owner_ref, (audit?.metadata as Record<string, unknown>).to_owner_ref], [null, OWNER_REF, OTHER_OWNER_REF])
})

Deno.test('o novo dono não consta no quadro societário: vínculo vai para a revisão da equipe (saque bloqueado)', async () => {
  const w = await makeWorld()
  const r = await transfer(w, { registry: OTHER_PARTNER })
  assertEquals([r.status, r.data.owner_link_check, r.data.owner_link_review], [200, 'mismatch', 'pending'])
  assertEquals(company(w).owner_link_review, 'pending')
  const down = await makeWorld()
  const rd = await transfer(down, { registry: async () => null }) // consulta ao cadastro do CNPJ fora do ar
  assertEquals([rd.data.owner_link_check, rd.data.owner_link_review], ['unavailable', 'pending'])
})

Deno.test('depois da troca: o dono antigo perde o acesso, o novo passa, e o saque só volta com chave nova E 48 h', async () => {
  const w = await makeWorld()
  assertEquals((await transfer(w)).status, 200)

  // dono antigo: NOT_OWNER em tudo
  const old = await withdrawOp(150_000)
  const rOld = await call(w, withdraw, { company_id: COMPANY_ID, owner_ref: OWNER_REF, amount_cents: 150_000, op: old.op }, { signature: old.signature })
  assertEquals([rOld.status, rOld.data.code], [403, 'NOT_OWNER'])

  // novo dono: sem chave, não saca (e a status avisa)
  const st = await call(w, status, { company_id: COMPANY_ID, owner_ref: OTHER_OWNER_REF })
  assertEquals(st.status, 200)
  assertEquals((st.data.pix_key as Record<string, unknown>).configured, false)
  assertEquals((st.data.withdraw as Record<string, unknown>).code, 'COMPANY_PIX_KEY_NOT_CONFIGURED')
  assertEquals(typeof (st.data.pix_key as Record<string, unknown>).available_at, 'string')

  // cadastra a chave do CNPJ: ainda NÃO saca, porque a espera de 48 h da troca vale
  const k = await signedOp({ kind: 'set_pix_key', owner_ref: OTHER_OWNER_REF, destination_digest: await (await import('../_shared/food-op.ts')).destinationDigest(COMPANY_ID, CNPJ) })
  const set = await call(w, setPixKey, { company_id: COMPANY_ID, owner_ref: OTHER_OWNER_REF, key_type: 'cnpj', cnpj: CNPJ, op: k.op }, { signature: k.signature })
  assertEquals(set.status, 200)
  const wd = await withdrawOp(150_000, CNPJ, { owner_ref: OTHER_OWNER_REF })
  const blocked = await call(w, withdraw, { company_id: COMPANY_ID, owner_ref: OTHER_OWNER_REF, amount_cents: 150_000, op: wd.op }, { signature: wd.signature })
  assertEquals([blocked.status, blocked.data.code], [403, 'PIX_KEY_RECENTLY_CHANGED'])
  assertEquals(transfers(w).length, 0)

  // 48 h depois, saca
  company(w).pix_key_changed_at = ago(49 * 3_600_000)
  const wd2 = await withdrawOp(150_000, CNPJ, { owner_ref: OTHER_OWNER_REF })
  const ok = await call(w, withdraw, { company_id: COMPANY_ID, owner_ref: OTHER_OWNER_REF, amount_cents: 150_000, op: wd2.op }, { signature: wd2.signature })
  assertEquals(ok.status, 200)
  assertEquals(txs0(w).actor_ref, OTHER_OWNER_REF)
})

const txs0 = (w: World) => w.db.rows('transactions')[0]!

Deno.test('limites de saque voltam ao padrão na troca e o pedido de aumento em aberto é cancelado (o histórico fica)', async () => {
  const w = await makeWorld({
    override: { withdraw_limit_per_tx_brl: '20000.00', withdraw_limit_per_day_brl: '60000.00', withdraw_limit_set_at: ago(D) },
    rows: {
      company_limit_requests: [
        { id: 'aprovado', company_id: COMPANY_ID, status: 'approved', requested_by_ref: OWNER_REF, created_at: ago(5 * D) },
        { id: 'aberto', company_id: COMPANY_ID, status: 'pending', requested_by_ref: OWNER_REF, created_at: ago(1 * D) },
        { id: 'outra-empresa', company_id: 'outra', status: 'pending', requested_by_ref: OWNER_REF, created_at: ago(1 * D) },
      ],
    },
  })
  const before = await call(w, status, { company_id: COMPANY_ID, owner_ref: OWNER_REF })
  assertEquals(before.data.limits, { per_tx_brl: 20000, per_day_brl: 60000, source: 'approved' })

  assertEquals((await transfer(w)).status, 200)
  const c = company(w)
  assertEquals([c.withdraw_limit_per_tx_brl, c.withdraw_limit_per_day_brl, c.withdraw_limit_set_at], [null, null, null])
  const statuses = Object.fromEntries(w.db.rows('company_limit_requests').map((r) => [r.id, r.status]))
  assertEquals(statuses, { aprovado: 'approved', aberto: 'cancelled', 'outra-empresa': 'pending' })

  const after = await call(w, status, { company_id: COMPANY_ID, owner_ref: OTHER_OWNER_REF })
  assertEquals((after.data.limits as Record<string, unknown>).source, 'default')
  assertEquals((after.data.limits as Record<string, unknown>).per_tx_brl, 5000)
  assertEquals((w.db.rows('audit_logs').find((a) => a.event_type === 'company_owner_transferred')?.metadata as Record<string, unknown>).limits_reset, true)
})

Deno.test('repetir a mesma autorização devolve o resultado original sem refazer a conferência nem zerar de novo', async () => {
  const w = await makeWorld()
  const s = await transferOp()
  const first = await transfer(w, { op: s })
  const second = await transfer(w, { op: s })
  assertEquals(second.data, first.data)
  assertEquals(second.registryCalls.length, 0) // não consultou o cadastro de novo
  assertEquals(foodOps(w).length, 1)
})

Deno.test('duas trocas ao mesmo tempo para donos diferentes: só uma vale', async () => {
  const w = await makeWorld()
  const a = await transferOp({ new_owner_ref: OTHER_OWNER_REF })
  const third = '44444444-4444-4444-8444-444444444444'
  const b = await transferOp({ new_owner_ref: third })
  const [ra, rb] = await withLiveWorld(w, () => Promise.all([
    call(w, handleRequest, body({ op: a.op }), { signature: a.signature }, { registry: MATCH }),
    call(w, handleRequest, body({ to_owner_ref: third, op: b.op }), { signature: b.signature }, { registry: MATCH }),
  ]))
  assertEquals([ra.status, rb.status].sort(), [200, 403])
  assertEquals([ra, rb].find((r) => r.status === 403)?.data.code, 'NOT_OWNER')
  assert([OTHER_OWNER_REF, third].includes(company(w).owner_ref as string))
})

Deno.test('autorização errada: de outro tipo, para outro novo dono, de outro dono, vencida, sem assinatura ou adulterada: 403 e nada muda', async () => {
  const w = await makeWorld()
  const wrongNew = await transferOp({ new_owner_ref: '55555555-5555-4555-8555-555555555555' })
  assertEquals((await transfer(w, { op: wrongNew })).data.code, 'INVALID_AUTHORIZATION')
  const asWithdraw = await withdrawOp(150_000)
  assertEquals((await transfer(w, { op: asWithdraw })).data.code, 'INVALID_AUTHORIZATION')
  const wrongOwner = await transferOp({ owner_ref: OTHER_OWNER_REF })
  assertEquals((await transfer(w, { op: wrongOwner })).data.code, 'INVALID_AUTHORIZATION')
  const expired = await transferOp({ issued_at: new Date(Date.now() - 100_000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() })
  assertEquals((await transfer(w, { op: expired })).data.code, 'INVALID_AUTHORIZATION')
  const s = await transferOp()
  const unsigned = await call(w, handleRequest, body({ op: s.op }), {}, { registry: MATCH })
  assertEquals(unsigned.data.code, 'INVALID_AUTHORIZATION')
  const tampered = await call(w, handleRequest, body({ op: { ...s.op, nonce: 'outro-nonce-qualquer-1' } }), { signature: s.signature }, { registry: MATCH })
  assertEquals(tampered.data.code, 'INVALID_AUTHORIZATION')
  assertEquals(company(w).owner_ref, OWNER_REF)
  assertEquals(company(w).pix_key_type, 'cnpj') // chave intacta
})

Deno.test('validações: CNPJ que não bate, CPF inválido, novo dono igual ao antigo, dono de origem errado, campos ausentes', async () => {
  const w = await makeWorld()
  assertEquals((await transfer(w, { extra: { cnpj: '11444777000161' } })).data.code, 'CNPJ_MISMATCH')
  assertEquals((await transfer(w, { extra: { cnpj: undefined } })).data.code, 'CNPJ_INVALID')
  assertEquals((await transfer(w, { extra: { new_owner: { cpf: '11111111111', name: 'Maria', phone: '11988887777' } } })).data.code, 'CPF_INVALID')
  assertEquals((await transfer(w, { extra: { new_owner: { cpf: CPF, name: 'M', phone: '1' } } })).data.code, 'INVALID_OWNER')
  assertEquals((await transfer(w, { extra: { to_owner_ref: OWNER_REF } })).data.code, 'INVALID_OWNER')
  assertEquals((await transfer(w, { extra: { new_owner: undefined } })).data.code, 'MISSING_FIELDS')
  assertEquals((await transfer(w, { extra: { op: undefined } })).data.code, 'MISSING_FIELDS')
  const wrongFrom = await transfer(w, { extra: { from_owner_ref: '66666666-6666-4666-8666-666666666666' } })
  assertEquals([wrongFrom.status, wrongFrom.data.code], [403, 'NOT_OWNER'])
  assertEquals(company(w).owner_ref, OWNER_REF)
  assertEquals(foodOps(w).length, 0)
})

Deno.test('chamada de serviço: só POST, só com a chave do Food; empresa inexistente 404', async () => {
  const w = await makeWorld()
  assertEquals((await call(w, handleRequest, {}, { method: 'GET' }, {})).status, 405)
  assertEquals((await call(w, handleRequest, body(), { key: null }, {})).status, 401)
  const none = await makeWorld({ override: null })
  assertEquals((await transfer(none)).status, 404)
})
