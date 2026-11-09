// Roda com: deno test supabase/functions/food-company-create/index.test.ts --allow-env --allow-net --allow-read
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { ago, call, CNPJ, COMPANY_ID, CPF, D, EVP, makeWorld, OTHER_OWNER_REF, OWNER_REF, signedRelease, uniq, type World } from '../_shared/food-test-kit.ts'
import { aesDecrypt, sha256hex } from '../_shared/crypto.ts'
import { decryptSubaccountKey } from '../_shared/subaccount-key.ts'
import type { CnpjRegistry } from '../_shared/owner-link.ts'
import { handleRequest } from './index.ts'

// CPF 529.982.247-25: dígitos 4 a 9 = 982247.
const registryWith = (partnerMask: string, role = 'Sócio-Administrador'): CnpjRegistry => ({ situation: 'ATIVA', legalName: 'RESTAURANTE LTDA', partners: [{ name: 'FULANO', cpfMask: partnerMask, role }] })
const MATCH = async () => registryWith('***982247**')
const STRANGER = async () => registryWith('***111111**')

const validBody = (over: { owner?: Record<string, unknown>; company?: Record<string, unknown>; owner_ref?: unknown } = {}) => ({
  owner_ref: over.owner_ref ?? OWNER_REF,
  owner: { cpf: CPF, name: 'Maria Souza', phone: '(11) 98888-7777', email: 'maria@exemplo.com', ...over.owner },
  company: {
    cnpj: '11.222.333/0001-81', company_name: 'Restaurante LTDA', trading_name: 'Meu Restaurante', company_type: 'LIMITED', email: 'contato@restaurante.com.br',
    tax_regime: 'NATIONAL_SIMPLE', income_value: 15000, handle: 'meurestaurante',
    address: { street: 'Rua X', number: '100', complement: 'Sala 2', district: 'Centro', cep: '01000-000', city: 'São Paulo', state: 'SP' },
    ...over.company,
  },
})

const newWorld = (rows: Record<string, Record<string, unknown>[]> = {}) => makeWorld({ override: null, rows })
const deps = (registry: () => Promise<CnpjRegistry | null> = MATCH) => ({ registry, sleep: async () => {} })
/** Chamada com o atestado de liberação da equipe (válido, amarrado ao dono, CNPJ e CPF do corpo), salvo se `opts.releaseSignature` for dado (inclusive null = sem cabeçalho). */
const run = async (w: World, body: unknown, registry?: () => Promise<CnpjRegistry | null>, opts: Parameters<typeof call>[3] = {}) => {
  const b = (body ?? {}) as { owner_ref?: unknown; owner?: { cpf?: unknown }; company?: { cnpj?: unknown } }
  const sr = await signedRelease({
    ...(typeof b.owner_ref === 'string' ? { ownerRef: b.owner_ref } : {}),
    ...(typeof b.company?.cnpj === 'string' ? { cnpj: b.company.cnpj } : {}),
    ...(typeof b.owner?.cpf === 'string' ? { cpf: b.owner.cpf } : {}),
  })
  const withRelease = typeof body === 'object' && body !== null ? { ...(body as object), release: sr.release } : body
  return call(w, handleRequest, withRelease, { releaseSignature: sr.signature, ...opts }, deps(registry))
}
const accountCalls = (w: World) => w.asaas.filter((c) => c.method === 'POST' && c.path === '/accounts')
const companies = (w: World) => w.db.rows('companies')

Deno.test('abre a empresa do Alber Food sem usuário: owner_id nulo, owner_ref, origin food, vínculo conferido, nada de users nem do CPF gravado', async () => {
  const w = await newWorld()
  const r = await run(w, validBody())
  assertEquals(r.status, 201)
  assertEquals(Object.keys(r.data).sort(), ['account_status', 'company_id', 'handle', 'kyc_status', 'onboarding_url', 'owner_link_check', 'owner_link_review'])
  assertEquals([r.data.handle, r.data.kyc_status, r.data.account_status, r.data.owner_link_check, r.data.owner_link_review], ['meurestaurante', 'pending', 'evaluation', 'match', 'approved'])
  assertEquals(r.data.onboarding_url, 'https://docs.test/onboarding')

  const [c] = companies(w)
  assertEquals(c?.id, r.data.company_id)
  assertEquals([c?.owner_id, c?.owner_ref, c?.origin, c?.owner_link_check, c?.owner_link_review, c?.owner_link_qualification], [null, OWNER_REF, 'food', 'match', 'approved', 'Sócio-Administrador'])
  assertEquals([c?.cnpj, c?.handle, c?.company_type, c?.province, c?.postal_code, c?.city, c?.state], [await sha256hex(CNPJ), 'meurestaurante', 'LIMITED', 'Centro', '01000000', 'São Paulo', 'SP'])
  assertEquals(await decryptSubaccountKey(c?.asaas_api_key_enc as string), 'new-sub-key')
  assertEquals(typeof c?.asaas_deposit_key === 'string' && await aesDecrypt(c.asaas_deposit_key as string, Deno.env.get('ENCRYPTION_KEY')!), EVP)
  assertEquals([c?.pix_key, c?.pix_key_type], [null, null]) // chave de saque só pelo food-company-set-pix-key

  // Asaas recebeu a empresa (CNPJ, telefone do dono só dígitos, e-mail de contato real) e o login sintético.
  const body = accountCalls(w)[0]?.body as Record<string, unknown>
  assertEquals([body.cpfCnpj, body.phone, body.mobilePhone, body.email, body.taxRegime, body.incomeValue], [CNPJ, '11988887777', '11988887777', 'contato@restaurante.com.br', 'NATIONAL_SIMPLE', 15000])
  assertEquals(body.loginEmail, `empresa-${CNPJ}@usealber.com`)

  // O dono não existe no Alber: nenhuma leitura ou escrita em users, e o CPF não vai a lugar nenhum além da comparação com o quadro societário.
  // (users só é lido na checagem de @ repetido entre usuários e empresas: nunca pelo id do dono, nunca escrito)
  assert(w.db.log.filter((l) => l.table === 'users').every((l) => l.method === 'GET' && l.query.has('handle') && !l.query.has('id')))
  assert(!JSON.stringify(w.db.log).includes(CPF) && !JSON.stringify(w.asaas).includes(CPF))
  assertEquals(w.pushes.length, 0)
  assertEquals(w.db.rows('audit_logs').find((a) => a.event_type === 'food_company_create')?.user_id, null)
})

Deno.test('liberada pela equipe, o vínculo nasce aprovado mesmo que a conferência automática não confirme (ela fica só como informação)', async () => {
  for (const [registry, check] of [[STRANGER, 'mismatch'], [async () => registryWith('***982247**', 'Sócio'), 'partner'], [async () => null, 'unavailable']] as const) {
    const w = await newWorld()
    const r = await run(w, validBody(), registry)
    assertEquals(r.status, 201)
    assertEquals([r.data.owner_link_check, r.data.owner_link_review], [check, 'approved'])
    assertEquals(companies(w)[0]?.owner_link_review, 'approved')
  }
})

Deno.test('sem atestado de liberação válido nada é criado: 403 INVALID_AUTHORIZATION sempre igual, com o motivo só no audit_logs', async () => {
  const good = await signedRelease()
  const now = Date.now()
  const cases: [string, Parameters<typeof signedRelease>[0] | null, string][] = [
    ['sem atestado', null, 'missing_signature'],
    ['dono diferente', { ownerRef: OTHER_OWNER_REF }, 'owner'],
    ['CNPJ diferente', { cnpj: '04252011000110' }, 'cnpj'],
    ['CPF diferente', { cpf: '39053344705' }, 'cpf'],
    ['vencido', { override: { issued_at: new Date(now - 300_000).toISOString(), expires_at: new Date(now - 200_000).toISOString() } }, 'expired'],
    ['validade longa demais', { override: { issued_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 600_000).toISOString() } }, 'ttl'],
  ]
  for (const [name, spec, reason] of cases) {
    const w = await newWorld()
    const sr = spec ? await signedRelease(spec) : null
    const body = { ...validBody(), ...(sr ? { release: sr.release } : {}) }
    const r = await call(w, handleRequest, body, sr ? { releaseSignature: sr.signature } : {}, deps())
    assertEquals([name, r.status, r.data.code], [name, 403, 'INVALID_AUTHORIZATION'])
    assertEquals(accountCalls(w).length, 0, name) // nada foi ao Asaas
    assertEquals(companies(w).length, 0, name)
    const log = w.db.rows('audit_logs').find((l) => l.event_type === 'food_op_rejected')
    assertEquals((log?.metadata as Record<string, unknown>)?.reason, reason, name)
    assertEquals(JSON.stringify(r.data).includes(reason), false, name) // a resposta não diz qual verificação falhou
  }
  // Assinatura de outro segredo, corpo adulterado depois de assinado e cabeçalho malformado.
  const w2 = await newWorld()
  const other = await signedRelease({}, 'cd'.repeat(32))
  assertEquals((await call(w2, handleRequest, { ...validBody(), release: other.release }, { releaseSignature: other.signature }, deps())).status, 403)
  assertEquals((await call(w2, handleRequest, { ...validBody(), release: { ...good.release, nonce: 'x'.repeat(20) } }, { releaseSignature: good.signature }, deps())).status, 403)
  assertEquals((await call(w2, handleRequest, { ...validBody(), release: good.release }, { releaseSignature: 'v1=zz' }, deps())).status, 403)
  assertEquals(accountCalls(w2).length, 0)
  // O atestado correto, uma vez, abre a empresa.
  assertEquals((await call(w2, handleRequest, { ...validBody(), release: good.release }, { releaseSignature: good.signature }, deps())).status, 201)
})

Deno.test('CPF do dono inválido 422 CPF_INVALID (sem Asaas); telefone, nome e owner_ref inválidos 422; owner ou company ausentes 400', async () => {
  const w = await newWorld()
  assertEquals((await run(w, validBody({ owner: { cpf: '111.111.111-11' } }))).data.code, 'CPF_INVALID')
  assertEquals((await run(w, validBody({ owner: { cpf: '123' } }))).data.code, 'CPF_INVALID')
  assertEquals((await run(w, validBody({ owner: { cpf: undefined } }))).data.code, 'MISSING_FIELDS')
  assertEquals((await run(w, validBody({ owner: { phone: '123' } }))).data.code, 'INVALID_OWNER')
  assertEquals((await run(w, validBody({ owner: { name: ' ' } }))).data.code, 'INVALID_OWNER')
  assertEquals((await run(w, validBody({ owner_ref: 'nao-uuid' }))).data.code, 'INVALID_OWNER')
  assertEquals((await run(w, { owner_ref: OWNER_REF, company: validBody().company })).data.code, 'MISSING_FIELDS')
  assertEquals((await run(w, { owner_ref: OWNER_REF, owner: validBody().owner })).data.code, 'MISSING_FIELDS')
  assertEquals((await run(w, validBody({ company: { address: undefined } }))).data.code, 'MISSING_FIELDS')
  assertEquals((await run(w, validBody({ company: { handle: undefined } }))).data.code, 'MISSING_FIELDS')
  assertEquals((await run(w, validBody({ company: { income_value: '15000' } }))).data.code, 'MISSING_FIELDS')
  assertEquals(accountCalls(w).length + companies(w).length, 0)
})

Deno.test('validações da empresa (as mesmas de company-create): CNPJ, tipo, handle, regime, e-mail', async () => {
  const w = await newWorld()
  assertEquals((await run(w, validBody({ company: { cnpj: '11.111.111/1111-11' } }))).data.code, 'CNPJ_INVALID')
  assertEquals((await run(w, validBody({ company: { company_type: 'SA' } }))).data.code, 'INVALID_COMPANY_TYPE')
  assertEquals((await run(w, validBody({ company: { handle: 'a' } }))).data.code, 'COMPANY_HANDLE_INVALID')
  assertEquals((await run(w, validBody({ company: { tax_regime: 'X' } }))).data.code, 'INVALID_TAX_REGIME')
  assertEquals((await run(w, validBody({ company: { email: 'sem-arroba' } }))).data.code, 'EMAIL_INVALID')
  assertEquals(accountCalls(w).length, 0)
})

Deno.test('@ da empresa já em uso por empresa ou por usuário do app: 409 (não há mais reserva de @ no Alber)', async () => {
  const takenByCompany = await newWorld({ companies: [{ id: uniq('c'), handle: 'meurestaurante', cnpj: 'outro-hash', deleted_at: null, owner_ref: OTHER_OWNER_REF }] })
  assertEquals((await run(takenByCompany, validBody())).data.code, 'COMPANY_HANDLE_TAKEN')
  const takenByUser = await newWorld({ users: [{ id: 'u1', handle: 'meurestaurante' }] })
  assertEquals((await run(takenByUser, validBody())).data.code, 'COMPANY_HANDLE_TAKEN')
})

Deno.test('CNPJ já cadastrado e aprovado por outro: 409 CNPJ_DUPLICATE; pendente de outro dono: 409 CNPJ_UNDER_REVIEW; nada vai ao Asaas', async () => {
  const cnpj = await sha256hex(CNPJ)
  const approved = await newWorld({ companies: [{ id: uniq('c'), handle: 'outro', cnpj, kyc_status: 'approved', owner_ref: OTHER_OWNER_REF, created_at: ago(2 * D), owner_link_check: 'match' }] })
  assertEquals([(await run(approved, validBody())).status, (await run(approved, validBody())).data.code], [409, 'CNPJ_DUPLICATE'])
  const pending = await newWorld({ companies: [{ id: uniq('c'), handle: 'outro', cnpj, kyc_status: 'pending', owner_ref: OTHER_OWNER_REF, created_at: ago(2 * D), owner_link_check: 'partner' }] })
  const r = await run(pending, validBody())
  assertEquals([r.status, r.data.code], [409, 'CNPJ_UNDER_REVIEW'])
  assertEquals(accountCalls(approved).length + accountCalls(pending).length, 0)
})

Deno.test('o MESMO dono repetindo a abertura do MESMO CNPJ recebe a empresa que já existe (200), sem nova subconta', async () => {
  const w = await newWorld()
  const first = await run(w, validBody())
  const again = await run(w, validBody())
  assertEquals([first.status, again.status], [201, 200])
  assertEquals(again.data, first.data)
  assertEquals(accountCalls(w).length, 1)
  assertEquals(companies(w).length, 1)
  // outro dono com o mesmo CNPJ não recebe a empresa do primeiro
  const other = await run(w, validBody({ owner_ref: OTHER_OWNER_REF, company: { handle: 'outrorestaurante' } }))
  assertEquals([other.status, other.data.code], [409, 'CNPJ_UNDER_REVIEW'])
})

Deno.test('disputa do CNPJ: pendência de mais de 14 dias sem documentos perde o CNPJ; quem tem vínculo conferido assume de quem não passou na conferência; documento enviado protege', async () => {
  const cnpj = await sha256hex(CNPJ)
  const row = (over: Record<string, unknown>) => ({ id: 'old-company', handle: 'antigo', cnpj, kyc_status: 'pending', owner_ref: OTHER_OWNER_REF, created_at: ago(2 * D), owner_link_check: 'partner', kyc_evidence: null, deleted_at: null, asaas_account_id: 'acc_old', ...over })

  const expired = await newWorld({ companies: [row({ created_at: ago(15 * D) })] })
  assertEquals((await run(expired, validBody())).status, 201)
  assertEquals(companies(expired).find((c) => c.id === 'old-company')?.deleted_reason, 'expired')
  assertEquals(expired.pushes.length, 0) // empresa antiga do Food: não há usuário do app para avisar

  const superseded = await newWorld({ companies: [row({ owner_link_check: 'mismatch' })] })
  assertEquals((await run(superseded, validBody())).status, 201)
  assertEquals(companies(superseded).find((c) => c.id === 'old-company')?.deleted_reason, 'superseded')

  const withDocs = await newWorld({ companies: [row({ created_at: ago(20 * D), kyc_evidence: { groups: [{ status: 'PENDING' }] } })] })
  assertEquals((await run(withDocs, validBody())).data.code, 'CNPJ_UNDER_REVIEW')

  const claimantNoMatch = await newWorld({ companies: [row({ owner_link_check: 'mismatch' })] })
  assertEquals((await run(claimantNoMatch, validBody(), STRANGER)).data.code, 'CNPJ_UNDER_REVIEW') // quem assume precisa do vínculo conferido

  // empresa pendente aberta pelo APP: o dono do app é avisado da perda do CNPJ
  const fromApp = await newWorld({ companies: [row({ owner_ref: null, owner_id: 'user-9', created_at: ago(15 * D) })] })
  assertEquals((await run(fromApp, validBody())).status, 201)
  assertEquals(fromApp.pushes.length, 1)
})

Deno.test('CNPJ já tem subconta no Asaas: sem vínculo conferido, ou subconta sem chave, é 409 CNPJ_IN_USE (nunca reaproveitada) e vira caso do suporte', async () => {
  const inUse = (w: World) => {
    w.asaasOverride = (c) => (c.method === 'POST' && c.path === '/accounts' ? new Response(JSON.stringify({ errors: [{ description: 'O cpfCnpj informado já está em uso' }] }), { status: 400 }) : null)
  }
  const noMatch = await newWorld()
  inUse(noMatch)
  const r1 = await run(noMatch, validBody(), STRANGER)
  assertEquals([r1.status, r1.data.code], [409, 'CNPJ_IN_USE'])
  assertEquals(noMatch.asaas.filter((c) => c.path.startsWith('/accounts?')).length, 0) // não buscou a subconta alheia

  const noKey = await newWorld()
  inUse(noKey)
  const base = noKey.asaasOverride
  noKey.asaasOverride = (c) => (c.method === 'GET' && c.path.startsWith('/accounts?') ? new Response(JSON.stringify({ data: [{ id: 'acc_orphan', walletId: 'w' }] }), { status: 200 }) : base?.(c) ?? null)
  const r2 = await run(noKey, validBody())
  assertEquals([r2.status, r2.data.code], [409, 'CNPJ_IN_USE'])
  assertEquals(companies(noKey).length, 0)
  assert(noKey.db.rows('error_logs').some((e) => e.function === 'company-dispute'))
})

Deno.test('erro genérico do Asaas ao criar a subconta: 503 ASAAS_ERROR e nada é gravado', async () => {
  const w = await newWorld()
  w.asaasOverride = (c) => (c.method === 'POST' && c.path === '/accounts' ? new Response(JSON.stringify({ errors: [{ description: 'Falha interna' }] }), { status: 500 }) : null)
  const r = await run(w, validBody())
  assertEquals([r.status, r.data.code], [503, 'ASAAS_ERROR'])
  assertEquals(companies(w).length, 0)
})

Deno.test('no máximo 5 aberturas por dono a cada 15 minutos (cada sucesso cria uma subconta real)', async () => {
  const recent = (ref: string, n: number) => Array.from({ length: n }, () => ({ id: uniq('a'), event_type: 'food_company_create_attempt', metadata: { owner_ref: ref }, created_at: ago(5 * 60_000) }))
  const w = await newWorld({ audit_logs: [...recent(OWNER_REF, 5), ...recent(OTHER_OWNER_REF, 1)] })
  const blocked = await run(w, validBody())
  assertEquals([blocked.status, blocked.data.code], [429, 'RATE_LIMITED'])
  assertEquals(accountCalls(w).length, 0)
  assertEquals((await run(w, validBody({ owner_ref: OTHER_OWNER_REF }))).status, 201) // outro dono não é afetado

  const old = await newWorld({ audit_logs: Array.from({ length: 5 }, () => ({ id: uniq('a'), event_type: 'food_company_create_attempt', metadata: { owner_ref: OWNER_REF }, created_at: ago(20 * 60_000) })) })
  assertEquals((await run(old, validBody())).status, 201) // fora da janela
})

Deno.test('chamada de serviço: só POST, só com a chave do Food, JSON válido', async () => {
  const w = await newWorld()
  assertEquals((await run(w, {}, MATCH, { method: 'GET' })).status, 405)
  for (const key of [null, 'errada']) assertEquals((await run(w, validBody(), MATCH, { key })).status, 401)
  assertEquals((await run(w, null, MATCH, { rawBody: '{x' })).data.code, 'INVALID_BODY')
  assertEquals((await run(w, null, MATCH, { rawBody: '"texto"' })).data.code, 'INVALID_BODY')
  assertEquals(accountCalls(w).length, 0)
  void COMPANY_ID
})
