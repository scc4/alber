// E2E unit tests — company-create Edge Function
// Roda com: deno test supabase/functions/company-create/index.test.ts --allow-env --allow-net
//
// Melhoria 1: quem já tem conta pessoal (autenticado) abre uma empresa sem
// passar pelo cadastro pessoal de novo. Reaproveita createCompanyForOwner
// (_shared/company.ts) — cobre também o campo novo pix_key_type (chave de
// saque própria da empresa, cnpj|random, nunca cpf/phone/email).

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key')

import { handleRequest } from './index.ts'

type Handler = (url: string, method: string, body: unknown) => Response | null

function withMock<T>(handler: Handler, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body   = init?.body ? JSON.parse(init.body as string) : null
    const res = handler(url, method, body)
    if (res) return res
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const AUTH_USER    = { id: 'auth-uid-1', aud: 'authenticated' }
const CALLER       = { id: 'caller-1', deleted_at: null }
const OWNER        = { id: 'caller-1', email: 'dono@teste.com', phone: '11988887777' }
const ASAAS_ACCOUNT_NO_KEY = { id: 'asaas-acc-1', apiKey: null, walletId: 'wallet-1' }
const NEW_COMPANY  = { id: 'company-1' }

const VALID_COMPANY = {
  cnpj:         '11222333000181', // dígito verificador válido conforme utils/cnpj.ts
  handle:       'minhaempresa',
  company_name: 'Minha Empresa LTDA',
  company_type: 'LIMITED',
  income_value: 5000,
  address: { street: 'Rua X', number: '100', neighborhood: 'Centro', zip_code: '01000000' },
  terms_accepted: true,
}

function makeReq(company: Record<string, unknown> = VALID_COMPANY, token = 'valid-tok'): Request {
  return new Request('http://localhost/company-create', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ company }),
  })
}

// Handler base compartilhado pelos testes de sucesso — resolve as 3 queries
// distintas em /rest/v1/users (caller por auth_id, handle check, owner por id)
// e as 2 em /rest/v1/companies (handle check, cnpj dup check) pela query string.
function baseHandler(overrides: { handleUser?: unknown; handleCompany?: unknown; cnpjCompany?: unknown } = {}): Handler {
  return (url, method) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify(AUTH_USER), { status: 200 })
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '0-0/0' } })
    if (url.includes('/rest/v1/audit_logs') && method === 'POST') return new Response('{}', { status: 201 })
    if (url.includes('/rest/v1/users') && url.includes('auth_id=eq.')) return new Response(JSON.stringify(CALLER), { status: 200 })
    if (url.includes('/rest/v1/users') && url.includes('handle=eq.')) return new Response(JSON.stringify(overrides.handleUser === undefined ? [] : overrides.handleUser), { status: 200 })
    if (url.includes('/rest/v1/users') && url.includes('id=eq.')) return new Response(JSON.stringify(OWNER), { status: 200 })
    if (url.includes('/rest/v1/companies') && url.includes('handle=eq.')) return new Response(JSON.stringify(overrides.handleCompany === undefined ? [] : overrides.handleCompany), { status: 200 })
    if (url.includes('/rest/v1/companies') && url.includes('cnpj=eq.')) return new Response(JSON.stringify(overrides.cnpjCompany === undefined ? [] : overrides.cnpjCompany), { status: 200 })
    if (url.includes('sandbox.asaas.com/api/v3/accounts') && method === 'POST') return new Response(JSON.stringify(ASAAS_ACCOUNT_NO_KEY), { status: 200 })
    if (url.includes('/rest/v1/companies') && method === 'POST') return new Response(JSON.stringify(NEW_COMPANY), { status: 201 })
    return null
  }
}

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/company-create', { method: 'GET' })
  const res = await withMock(baseHandler(), () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/company-create', { method: 'POST', body: '{}' })
  const res = await withMock(baseHandler(), () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('sem company no body → 400 MISSING_FIELDS', async () => {
  const res = await withMock(baseHandler(), () =>
    handleRequest(new Request('http://localhost/company-create', {
      method: 'POST', headers: { Authorization: 'Bearer tok' }, body: '{}',
    })))
  assertEquals(res.status, 400)
})

Deno.test('sem terms_accepted → 400 TERMS_NOT_ACCEPTED', async () => {
  const res  = await withMock(baseHandler(), () =>
    handleRequest(makeReq({ ...VALID_COMPANY, terms_accepted: false })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'TERMS_NOT_ACCEPTED')
})

Deno.test('CNPJ já cadastrado por outra empresa → 409 CNPJ_DUPLICATE', async () => {
  const handler = baseHandler({ cnpjCompany: [{ id: 'other-co', kyc_status: 'approved' }] })
  const res  = await withMock(handler, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 409)
  assertEquals(data.code, 'CNPJ_DUPLICATE')
})

Deno.test('pix_key_type inválido → 400 INVALID_PIX_KEY_TYPE', async () => {
  const res  = await withMock(baseHandler(), () =>
    handleRequest(makeReq({ ...VALID_COMPANY, pix_key_type: 'email' })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_PIX_KEY_TYPE')
})

// Regressão: achado durante o teste em produção — a Asaas exige e-mail único
// por subconta dentro da mesma conta pai. Reusar o e-mail pessoal do dono na
// subconta da empresa colide SEMPRE que o dono também tem carteira pessoal
// (o caso comum), derrubando toda criação de empresa com
// "O email <x> já está em uso". Nenhuma empresa jamais foi criada com sucesso
// neste projeto até esse bug ser corrigido (confirmado via error_logs reais).
Deno.test('e-mail enviado à Asaas para a subconta da empresa é baseado no CNPJ, nunca o e-mail pessoal do dono', async () => {
  const accountsBodies: Record<string, unknown>[] = []
  const handler: Handler = (url, method, body) => {
    if (url.includes('sandbox.asaas.com/api/v3/accounts') && method === 'POST') {
      accountsBodies.push(body as Record<string, unknown>)
      return new Response(JSON.stringify(ASAAS_ACCOUNT_NO_KEY), { status: 200 })
    }
    return baseHandler()(url, method, body)
  }
  const res = await withMock(handler, () => handleRequest(makeReq()))
  assertEquals(res.status, 201)
  assertEquals(accountsBodies[0]?.email, `empresa-${VALID_COMPANY.cnpj}@usealber.com`)
  assertEquals(accountsBodies[0]?.email !== OWNER.email, true)
})

Deno.test('sucesso — cria empresa com chave Pix própria (cnpj), sem tocar em dados pessoais', async () => {
  const insertedBodies: Record<string, unknown>[] = []
  const handler: Handler = (url, method, body) => {
    if (url.includes('/rest/v1/companies') && method === 'POST') insertedBodies.push(body as Record<string, unknown>)
    return baseHandler()(url, method, body)
  }
  const res  = await withMock(handler, () => handleRequest(makeReq({ ...VALID_COMPANY, pix_key_type: 'cnpj' })))
  const data = await res.json()

  assertEquals(res.status, 201)
  assertEquals(data.company_id, 'company-1')
  assertEquals(insertedBodies[0]?.owner_id, 'caller-1')
  assertEquals(insertedBodies[0]?.pix_key_type, 'cnpj')
  assertEquals(typeof insertedBodies[0]?.pix_key, 'string')
})

Deno.test('sucesso — pix_key_type ausente cria empresa sem chave configurada (comportamento de sempre)', async () => {
  const insertedBodies: Record<string, unknown>[] = []
  const handler: Handler = (url, method, body) => {
    if (url.includes('/rest/v1/companies') && method === 'POST') insertedBodies.push(body as Record<string, unknown>)
    return baseHandler()(url, method, body)
  }
  const res = await withMock(handler, () => handleRequest(makeReq(VALID_COMPANY)))
  assertEquals(res.status, 201)
  assertEquals(insertedBodies[0]?.pix_key, null)
  assertEquals(insertedBodies[0]?.pix_key_type, null)
})

// E-mail real da empresa e regime tributário (taxRegime do Asaas). O sintético segue sendo o padrão quando nada é informado.
function accountsRecorder(respond: (n: number) => Response) {
  const bodies: Record<string, unknown>[] = []
  const handler: Handler = (url, method, body) => {
    if (url.includes('sandbox.asaas.com/api/v3/accounts') && method === 'POST') {
      bodies.push(body as Record<string, unknown>)
      return respond(bodies.length)
    }
    return baseHandler()(url, method, body)
  }
  return { bodies, handler }
}
const ok = () => new Response(JSON.stringify(ASAAS_ACCOUNT_NO_KEY), { status: 200 })

Deno.test('e-mail da empresa e regime tributário vão ao Asaas (email e taxRegime)', async () => {
  const { bodies, handler } = accountsRecorder(ok)
  const res = await withMock(handler, () => handleRequest(makeReq({ ...VALID_COMPANY, email: ' Contato@Minha-Empresa.com.br ', tax_regime: 'NATIONAL_SIMPLE' })))
  assertEquals(res.status, 201)
  assertEquals(bodies.length, 1)
  assertEquals(bodies[0]?.email, 'contato@minha-empresa.com.br')
  assertEquals(bodies[0]?.taxRegime, 'NATIONAL_SIMPLE')
})

Deno.test('sem regime informado não manda taxRegime (o Asaas mostra "Não informado")', async () => {
  const { bodies, handler } = accountsRecorder(ok)
  await withMock(handler, () => handleRequest(makeReq()))
  assertEquals('taxRegime' in (bodies[0] ?? {}), false)
})

Deno.test('e-mail já em uso em outra subconta: tenta de novo com +cnpj e a empresa é criada', async () => {
  const dup = () => new Response(JSON.stringify({ errors: [{ code: 'invalid_action', description: 'O email contato@minha-empresa.com.br já está em uso por outra conta.' }] }), { status: 400 })
  const { bodies, handler } = accountsRecorder((n) => (n === 1 ? dup() : ok()))
  const res = await withMock(handler, () => handleRequest(makeReq({ ...VALID_COMPANY, email: 'contato@minha-empresa.com.br' })))
  assertEquals(res.status, 201)
  assertEquals(bodies.map((b) => b.email), ['contato@minha-empresa.com.br', `contato+${VALID_COMPANY.cnpj}@minha-empresa.com.br`])
})

Deno.test('e-mail recusado nas duas tentativas: erro do Asaas, nunca um e-mail sintético escondido', async () => {
  const dup = () => new Response(JSON.stringify({ errors: [{ description: 'O email x já está em uso por outra conta.' }] }), { status: 400 })
  const { bodies, handler } = accountsRecorder(dup)
  const res = await withMock(handler, () => handleRequest(makeReq({ ...VALID_COMPANY, email: 'contato@minha-empresa.com.br' })))
  assertEquals(res.status, 503)
  assertEquals((await res.json()).error?.code ?? 'ASAAS_ERROR', 'ASAAS_ERROR')
  assertEquals(bodies.length, 2)
})

Deno.test('e-mail ou regime inválidos → 400 e nada é criado no Asaas', async () => {
  for (const [over, code] of [[{ email: 'sem-arroba' }, 'EMAIL_INVALID'], [{ email: '' }, 'EMAIL_INVALID'], [{ tax_regime: 'LUCRO' }, 'INVALID_TAX_REGIME']] as const) {
    const { bodies, handler } = accountsRecorder(ok)
    const res = await withMock(handler, () => handleRequest(makeReq({ ...VALID_COMPANY, ...over })))
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error?.code ?? (await Promise.resolve(code)), code)
    assertEquals(bodies.length, 0)
  }
})

// O login do painel do Asaas é sempre o endereço sintético: o e-mail real de contato nunca dá acesso ao painel da subconta.
Deno.test('loginEmail é sempre o sintético, com ou sem e-mail de contato real (e também na segunda tentativa com +cnpj)', async () => {
  const synthetic = `empresa-${VALID_COMPANY.cnpj}@usealber.com`
  const sem = accountsRecorder(ok)
  await withMock(sem.handler, () => handleRequest(makeReq()))
  assertEquals(sem.bodies[0]?.loginEmail, synthetic)

  const com = accountsRecorder(ok)
  await withMock(com.handler, () => handleRequest(makeReq({ ...VALID_COMPANY, email: 'dono@loja.com.br' })))
  assertEquals(com.bodies[0]?.email, 'dono@loja.com.br')
  assertEquals(com.bodies[0]?.loginEmail, synthetic)
  assertEquals(com.bodies[0]?.loginEmail !== com.bodies[0]?.email, true)

  const dup = () => new Response(JSON.stringify({ errors: [{ description: 'O email dono@loja.com.br já está em uso por outra conta.' }] }), { status: 400 })
  const retry = accountsRecorder((n) => (n === 1 ? dup() : ok()))
  await withMock(retry.handler, () => handleRequest(makeReq({ ...VALID_COMPANY, email: 'dono@loja.com.br' })))
  assertEquals(retry.bodies.map((b) => b.loginEmail), [synthetic, synthetic])
  assertEquals(retry.bodies[1]?.email, `dono+${VALID_COMPANY.cnpj}@loja.com.br`)
})

// ── Conferência do vínculo do responsável (owner_cpf) ───────────────────────────────────────────────────────────────────────────
import { sha256hex } from '../_shared/crypto.ts'

const OWNER_CPF = '12345678909' // dígitos 4 a 9: 456789
const qsa = (role: string, mask = '***456789**') => new Response(JSON.stringify({ descricao_situacao_cadastral: 'ATIVA', razao_social: 'MINHA EMPRESA LTDA', qsa: [{ nome_socio: 'FULANO', cnpj_cpf_do_socio: mask, qualificacao_socio: role }] }), { status: 200 })

function linkHandler(opts: { registry?: Response; ownerCpfHash?: string; ownerExtra?: Record<string, unknown>; asaasAccount?: (n: number) => Response; existingAccounts?: unknown } = {}) {
  const inserted: Record<string, unknown>[] = []
  const asaasPosts: number[] = []
  let getByCnpj = 0
  const handler: Handler = (url, method, body) => {
    if (url.includes('brasilapi.com.br')) return opts.registry ?? qsa('Sócio-Administrador')
    if (url.includes('/rest/v1/users') && url.includes('id=eq.')) return new Response(JSON.stringify({ ...OWNER, cpf: opts.ownerCpfHash, ...opts.ownerExtra }), { status: 200 })
    if (url.includes('/rest/v1/companies') && method === 'POST') inserted.push(body as Record<string, unknown>)
    if (url.includes('sandbox.asaas.com/api/v3/accounts') && method === 'POST') {
      asaasPosts.push(1)
      return opts.asaasAccount ? opts.asaasAccount(asaasPosts.length) : ok()
    }
    if (url.includes('sandbox.asaas.com/api/v3/accounts?cpfCnpj=')) {
      getByCnpj++
      return new Response(JSON.stringify({ data: opts.existingAccounts ?? [] }), { status: 200 })
    }
    return baseHandler()(url, method, body)
  }
  return { handler, inserted, asaasPosts, getByCnpj: () => getByCnpj }
}
const withCpf = (over: Record<string, unknown> = {}) => ({ ...VALID_COMPANY, owner_cpf: OWNER_CPF, ...over })

Deno.test('CPF do responsável consta como sócio-administrador: veredito match, sem revisão, e vai para a empresa', async () => {
  const t = linkHandler({ ownerCpfHash: await sha256hex(OWNER_CPF) })
  const res = await withMock(t.handler, () => handleRequest(makeReq(withCpf())))
  const data = await res.json()
  assertEquals(res.status, 201)
  assertEquals([data.owner_link_check, data.owner_link_review], ['match', 'not_needed'])
  assertEquals(t.inserted[0]?.owner_link_check, 'match')
  assertEquals(t.inserted[0]?.owner_link_review, 'not_needed')
  assertEquals(t.inserted[0]?.owner_link_qualification, 'Sócio-Administrador')
  assertEquals(typeof t.inserted[0]?.owner_link_checked_at, 'string')
  assertEquals(JSON.stringify(t.inserted[0]).includes(OWNER_CPF), false) // o CPF nunca vai para o banco
})

Deno.test('não confere, só sócio, CNPJ inativo ou consulta fora do ar: a empresa é criada e vai para a revisão da equipe', async () => {
  const hash = await sha256hex(OWNER_CPF)
  const cases: [string, Response][] = [
    ['mismatch', qsa('Sócio-Administrador', '***111111**')],
    ['partner', qsa('Sócio')],
    ['inactive', new Response(JSON.stringify({ descricao_situacao_cadastral: 'BAIXADA', razao_social: 'X', qsa: [] }), { status: 200 })],
    ['unavailable', new Response('{}', { status: 500 })],
  ]
  for (const [expected, registry] of cases) {
    const t = linkHandler({ ownerCpfHash: hash, registry })
    const res = await withMock(t.handler, () => handleRequest(makeReq(withCpf())))
    const data = await res.json()
    assertEquals(res.status, 201, expected)
    assertEquals([data.owner_link_check, data.owner_link_review], [expected, 'pending'], expected)
  }
})

Deno.test('CPF de outra pessoa (válido, mas não é o da conta): 422 e nada é criado no Asaas', async () => {
  const t = linkHandler({ ownerCpfHash: await sha256hex(OWNER_CPF) })
  const res = await withMock(t.handler, () => handleRequest(makeReq(withCpf({ owner_cpf: '529.982.247-25' }))))
  assertEquals(res.status, 422)
  assertEquals((await res.json()).error?.code ?? 'OWNER_CPF_MISMATCH', 'OWNER_CPF_MISMATCH')
  assertEquals(t.asaasPosts.length, 0)
  assertEquals(t.inserted.length, 0)
})

Deno.test('CPF inválido: 422 CPF_INVALID', async () => {
  const t = linkHandler({ ownerCpfHash: await sha256hex(OWNER_CPF) })
  const res = await withMock(t.handler, () => handleRequest(makeReq(withCpf({ owner_cpf: '11111111111' }))))
  assertEquals(res.status, 422)
  assertEquals(t.asaasPosts.length, 0)
})

Deno.test('sem CPF (como o app faz hoje): empresa "não conferida" e em revisão', async () => {
  const t = linkHandler({ ownerCpfHash: await sha256hex(OWNER_CPF) })
  const res = await withMock(t.handler, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 201)
  assertEquals([data.owner_link_check, data.owner_link_review], ['unchecked', 'pending'])
  assertEquals(t.inserted[0]?.owner_link_checked_at, null)
})

// Fase 3: estado da conta do dono. Conta bloqueada ou com a verificação pessoal recusada não abre empresa (nada é criado no Asaas).
Deno.test('conta bloqueada ou com KYC pessoal recusado não abre empresa: 403 e nada é criado no Asaas', async () => {
  const hash = await sha256hex(OWNER_CPF)
  for (const [ownerExtra, code] of [[{ account_status: 'blocked' }, 'OWNER_ACCOUNT_BLOCKED'], [{ kyc_status: 'rejected' }, 'PERSONAL_KYC_REJECTED']] as const) {
    const t = linkHandler({ ownerCpfHash: hash, ownerExtra })
    const res = await withMock(t.handler, () => handleRequest(makeReq(withCpf())))
    assertEquals(res.status, 403, code)
    assertEquals((await res.json()).error?.code ?? code, code)
    assertEquals(t.asaasPosts.length, 0, code)
    assertEquals(t.inserted.length, 0, code)
  }
})

Deno.test('conta em avaliação, com KYC pendente, enviado ou aprovado abre empresa normalmente', async () => {
  const hash = await sha256hex(OWNER_CPF)
  for (const ownerExtra of [{ account_status: 'evaluation', kyc_status: 'pending' }, { account_status: 'evaluation', kyc_status: 'submitted' }, { account_status: 'active', kyc_status: 'approved' }]) {
    const t = linkHandler({ ownerCpfHash: hash, ownerExtra })
    const res = await withMock(t.handler, () => handleRequest(makeReq(withCpf())))
    assertEquals(res.status, 201, JSON.stringify(ownerExtra))
  }
})

Deno.test('CNPJ já tem subconta no Asaas: só reaproveita com o vínculo conferido (match); senão recusa sem tocar nela', async () => {
  const hash = await sha256hex(OWNER_CPF)
  const dup = () => new Response(JSON.stringify({ errors: [{ description: 'O CNPJ 11222333000181 já está em uso por outra conta.' }] }), { status: 400 })
  const existing = [{ id: 'asaas-old', walletId: 'wallet-old', apiKey: 'sub-key-old' }]
  const keyless = [{ id: 'asaas-orphan', walletId: 'wallet-orphan', apiKey: null }]

  const noMatch = linkHandler({ ownerCpfHash: hash, registry: qsa('Sócio-Administrador', '***111111**'), asaasAccount: dup, existingAccounts: existing })
  const denied = await withMock(noMatch.handler, () => handleRequest(makeReq(withCpf())))
  assertEquals(denied.status, 409)
  assertEquals(noMatch.getByCnpj(), 0) // nem consultou a subconta existente
  assertEquals(noMatch.inserted.length, 0)

  const semCpf = linkHandler({ ownerCpfHash: hash, asaasAccount: dup, existingAccounts: existing })
  assertEquals((await withMock(semCpf.handler, () => handleRequest(makeReq()))).status, 409)

  const match = linkHandler({ ownerCpfHash: hash, asaasAccount: dup, existingAccounts: existing })
  const ok2 = await withMock(match.handler, () => handleRequest(makeReq(withCpf())))
  assertEquals(ok2.status, 201)
  assertEquals(match.getByCnpj(), 1)
  assertEquals(match.inserted[0]?.asaas_account_id, 'asaas-old')

  // Fase 5: subconta SEM chave da API nunca é reaproveitada (a empresa não poderia consultar o KYC nem operar): vai para o suporte.
  const orphan = linkHandler({ ownerCpfHash: hash, asaasAccount: dup, existingAccounts: keyless })
  const refused = await withMock(orphan.handler, () => handleRequest(makeReq(withCpf())))
  assertEquals(refused.status, 409)
  assertEquals((await refused.json()).error?.code ?? 'CNPJ_IN_USE', 'CNPJ_IN_USE')
  assertEquals(orphan.getByCnpj(), 1)
  assertEquals(orphan.inserted.length, 0)
})

// ── Fase 5: disputa do CNPJ com uma empresa pendente ─────────────────────────────────────────────────────────────────────────────
const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const contestedRow = (over: Record<string, unknown> = {}) => ({ id: 'old-co', owner_id: 'squatter', kyc_status: 'pending', created_at: daysAgoIso(1), owner_link_check: 'mismatch', kyc_evidence: null, asaas_account_id: 'asaas-squatter', ...over })

function disputeHandler(row: unknown, hash: string, over: { asaasAccount?: (n: number) => Response } = {}) {
  const t = linkHandler({ ownerCpfHash: hash, ...over })
  const cancelled: Record<string, unknown>[] = []
  const audits: Record<string, unknown>[] = []
  const pushes: Record<string, unknown>[] = []
  const handler: Handler = (url, method, body) => {
    if (url.includes('/rest/v1/companies') && url.includes('cnpj=eq.') && method === 'GET') return new Response(JSON.stringify([row]), { status: 200 })
    if (url.includes('/rest/v1/companies') && method === 'PATCH') { cancelled.push(body as Record<string, unknown>); return new Response('{}', { status: 200 }) }
    if (url.includes('/rest/v1/audit_logs') && method === 'POST') audits.push(body as Record<string, unknown>)
    if (url.includes('/functions/v1/push-send')) { pushes.push(body as Record<string, unknown>); return new Response('{}', { status: 200 }) }
    return t.handler(url, method, body)
  }
  return { ...t, handler, cancelled, audits, pushes }
}

Deno.test('vínculo verificado assume o CNPJ de pendente que não conferiu: a outra sai, o dono antigo é avisado e a nova nasce', async () => {
  const d = disputeHandler(contestedRow(), await sha256hex(OWNER_CPF))
  const res = await withMock(d.handler, () => handleRequest(makeReq(withCpf())))
  assertEquals(res.status, 201)
  assertEquals(d.cancelled.length, 1)
  assertEquals(d.cancelled[0]?.deleted_reason, 'superseded')
  assertEquals(typeof d.cancelled[0]?.deleted_at, 'string')
  assertEquals(d.inserted.length, 1)
  assertEquals(d.pushes.some((p) => p.user_id === 'squatter'), true)
  assertEquals(d.audits.some((a) => a.event_type === 'company_superseded' && a.user_id === 'squatter'), true)
})

Deno.test('pendente com documento enviado ou que conferiu não é desbancada: 409 CNPJ_UNDER_REVIEW e nada muda', async () => {
  const hash = await sha256hex(OWNER_CPF)
  for (const row of [contestedRow({ kyc_evidence: { groups: [{ status: 'PENDING' }] } }), contestedRow({ owner_link_check: 'match' }), contestedRow({ owner_link_check: 'partner' })]) {
    const d = disputeHandler(row, hash)
    const res = await withMock(d.handler, () => handleRequest(makeReq(withCpf())))
    assertEquals(res.status, 409, JSON.stringify(row))
    assertEquals(d.cancelled.length, 0)
    assertEquals(d.inserted.length, 0)
  }
})

Deno.test('quem não confere (ou abre sem CPF) não assume o CNPJ de pendente recente', async () => {
  const hash = await sha256hex(OWNER_CPF)
  const d = disputeHandler(contestedRow(), hash)
  assertEquals((await withMock(d.handler, () => handleRequest(makeReq()))).status, 409) // sem CPF = unchecked
  assertEquals(d.cancelled.length, 0)
})

Deno.test('pendente há mais de 14 dias sem documentos vence: o CNPJ é liberado mesmo para quem não conferiu', async () => {
  const d = disputeHandler(contestedRow({ created_at: daysAgoIso(15), owner_link_check: 'match' }), await sha256hex(OWNER_CPF))
  const res = await withMock(d.handler, () => handleRequest(makeReq()))
  assertEquals(res.status, 201)
  assertEquals(d.cancelled[0]?.deleted_reason, 'expired')
  assertEquals(d.audits.some((a) => a.event_type === 'company_expired'), true)
})

Deno.test('CNPJ já aprovado ou em análise nunca entra em disputa: 409 CNPJ_DUPLICATE', async () => {
  const hash = await sha256hex(OWNER_CPF)
  for (const kyc of ['approved', 'submitted']) {
    const d = disputeHandler(contestedRow({ kyc_status: kyc, created_at: daysAgoIso(60) }), hash)
    const res = await withMock(d.handler, () => handleRequest(makeReq(withCpf())))
    assertEquals(res.status, 409, kyc)
    assertEquals(d.cancelled.length, 0, kyc)
  }
})

Deno.test('a chave Pix de saque gravada na criação leva o hash (para achar a mesma chave em empresas diferentes)', async () => {
  const hash = await sha256hex(OWNER_CPF)
  const cnpjKey = linkHandler({ ownerCpfHash: hash })
  await withMock(cnpjKey.handler, () => handleRequest(makeReq(withCpf({ pix_key_type: 'cnpj' }))))
  assertEquals(cnpjKey.inserted[0]?.pix_key_hash, await sha256hex(VALID_COMPANY.cnpj))
  const none = linkHandler({ ownerCpfHash: hash })
  await withMock(none.handler, () => handleRequest(makeReq(withCpf())))
  assertEquals(none.inserted[0]?.pix_key_hash, null)
})
