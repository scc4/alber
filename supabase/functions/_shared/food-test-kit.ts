// Kit dos testes das funções food-company-* (NÃO é código de produção): ambiente, "mundo" em memória (banco falso + Asaas simulado),
// autorização assinada e chamada de uma função com a chave de serviço. Importar este módulo define as variáveis de ambiente dos testes.

Deno.env.set('SUPABASE_URL', 'https://supabase.test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test')
Deno.env.set('ALBER_FOOD_SERVICE_KEY', 'f'.repeat(40))
Deno.env.set('FOOD_OP_SIGNING_KEY', 'ab'.repeat(32))
Deno.env.set('ASAAS_API_KEY', 'parent-key-parent-key-parent-key-1234')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('ASAAS_WEBHOOK_SECRET', 'webhook-secret-test')
Deno.env.set('ENCRYPTION_KEY', 'pix-key-encryption-secret-test')
Deno.env.delete('ALBER_KEYS_ENCRYPTION_KEY')
Deno.env.delete('ASAAS_PARENT_WALLET_ID')

import { FakeDb, installFakeFetch, type Row } from './fake-postgrest.ts'
import { aesEncrypt, sha256hex } from './crypto.ts'
import { encryptSubaccountKey } from './subaccount-key.ts'
import { destinationDigest, signFoodOp, type FoodOp } from './food-op.ts'

export const SERVICE_KEY = 'f'.repeat(40)
export const SIGNING_SECRET = 'ab'.repeat(32)
export const COMPANY_ID = '11111111-1111-4111-8111-111111111111'
export const OWNER_REF = '22222222-2222-4222-8222-222222222222'
export const OTHER_OWNER_REF = '33333333-3333-4333-8333-333333333333'
export const CNPJ = '11222333000181'
export const CPF = '52998224725'
export const EVP = '0f1e2d3c-4b5a-4968-8776-655443322110'
export const SUB_KEY = 'sub-api-key-123'

export const D = 24 * 3_600_000
export const H = 3_600_000
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

let seq = 0
export const uniq = (prefix = 'id') => `${prefix}-${String(++seq).padStart(10, '0')}-${crypto.randomUUID().slice(0, 8)}`

// ── Mundo ────────────────────────────────────────────────────────────────────

export interface AsaasCall { method: string; path: string; body: Record<string, unknown> | null; key: string | null }

export interface World {
  db: FakeDb
  /** Chamadas ao Asaas (qualquer caminho). */
  asaas: AsaasCall[]
  /** Chamadas ao push-send. */
  pushes: unknown[]
  /** Saldo da subconta em reais. */
  balance: number
  /** Respostas do Asaas por (método caminho); devolver null cai no padrão. */
  asaasOverride?: (call: AsaasCall) => Response | null
  /** Caminhos de rede que devem cair (lançam exceção, como um timeout). */
  networkDown: string[]
  /** true enquanto withLiveWorld mantém o mundo instalado (chamadas simultâneas). */
  live?: boolean
}

export interface CompanyOptions {
  /** Linha inteira por cima do padrão; null = sem empresa. */
  override?: Partial<Row> | null
  /** Chave Pix de saque: tipo e valor em claro (null = sem chave). Padrão: CNPJ. */
  pixKey?: { type: 'cnpj' | 'random'; clear: string } | null
}

export async function companyRow(opts: CompanyOptions = {}): Promise<Row> {
  const key = opts.pixKey === undefined ? { type: 'cnpj' as const, clear: CNPJ } : opts.pixKey
  const cnpjHash = await sha256hex(CNPJ)
  return {
    id: COMPANY_ID,
    handle: 'meurestaurante',
    owner_id: null,
    owner_ref: OWNER_REF,
    origin: 'food',
    asaas_account_id: 'acc_1',
    asaas_wallet_id: 'wallet_1',
    asaas_api_key_enc: await encryptSubaccountKey(SUB_KEY),
    cnpj: cnpjHash,
    cnpj_masked: '**.***.***/0001-81',
    company_name: 'Restaurante LTDA',
    kyc_status: 'approved',
    account_status: 'active',
    onboarding_url: null,
    pix_key: key ? await aesEncrypt(key.clear, Deno.env.get('ENCRYPTION_KEY')!) : null,
    pix_key_type: key ? key.type : null,
    pix_key_hash: key ? (key.type === 'cnpj' ? cnpjHash : await sha256hex(key.clear)) : null,
    pix_key_changed_at: null,
    pix_key_set_at: key ? ago(60 * D) : null,
    owner_link_check: 'match',
    owner_link_review: 'not_needed',
    owner_link_qualification: 'Sócio-Administrador',
    kyc_approved_at: ago(90 * D),
    kyc_evidence: null,
    withdraw_limit_per_tx_brl: null,
    withdraw_limit_per_day_brl: null,
    deleted_at: null,
    deleted_reason: null,
    created_at: ago(100 * D),
    ...(opts.override ?? {}),
  }
}

export async function makeWorld(opts: CompanyOptions & { rows?: Record<string, Row[]> } = {}): Promise<World> {
  const db = new FakeDb(opts.rows ?? {})
  if (opts.override !== null) db.rows('companies').push(await companyRow(opts))

  // Constraints da migration 058 (e as anteriores que os testes exercitam).
  db.unique.companies = [
    { cols: ['cnpj'], where: (r) => r.deleted_at == null },
    { cols: ['handle'], where: (r) => r.deleted_at == null },
    { cols: ['asaas_account_id'] },
  ]
  db.checks.companies = (r) => (r.owner_id == null && r.owner_ref == null ? 'companies_owner_present_check' : null)
  db.defaults.companies = () => ({ origin: 'app', kyc_status: 'pending', account_status: 'evaluation', deleted_at: null })
  db.checks.transactions = (r) => (r.user_id == null && r.actor_ref == null ? 'transactions_actor_present_check' : null)
  db.unique.food_ops = [{ cols: ['nonce'] }, { cols: ['idempotency_key'] }]
  db.notNull.food_ops = ['nonce', 'idempotency_key', 'kind', 'company_id', 'owner_ref']
  db.defaults.food_ops = () => ({ status: 'in_progress', result: null, expires_at: new Date(Date.now() + 7 * D).toISOString() })
  db.unique.company_limit_requests = [{ cols: ['company_id'], where: (r) => r.status === 'pending' }]
  db.checks.company_limit_requests = (r) => (r.requested_by == null && r.requested_by_ref == null ? 'company_limit_requests_requester_present_check' : null)
  db.defaults.company_limit_requests = () => ({ status: 'pending', updated_at: new Date().toISOString() })
  return { db, asaas: [], pushes: [], balance: 5000, networkDown: [] }
}

function asaasDefault(world: World, call: AsaasCall): Response {
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
  if (call.method === 'GET' && call.path.startsWith('/finance/balance')) return j({ balance: world.balance })
  if (call.method === 'POST' && call.path === '/transfers') return j({ id: 'tr_1', status: 'PENDING' })
  if (call.method === 'POST' && call.path === '/pix/addressKeys') return j({ key: EVP, type: 'EVP' })
  if (call.method === 'GET' && call.path.startsWith('/myAccount/status')) return j({ general: 'APPROVED' })
  if (call.method === 'GET' && call.path.startsWith('/myAccount/documents')) return j({ onboardingUrl: 'https://docs.test/onboarding', data: [] })
  if (call.method === 'POST' && call.path === '/accounts') return j({ id: 'acc_new', apiKey: 'new-sub-key', walletId: 'wallet_new' })
  if (call.method === 'GET' && call.path.startsWith('/accounts')) return j({ data: [] })
  return j({ error: `Asaas não simulado: ${call.method} ${call.path}` }, 500)
}

export function installWorld(world: World): () => void {
  return installFakeFetch(world.db, (url, init, method) => {
    if (url.includes('/functions/v1/push-send')) {
      world.pushes.push(init?.body ? JSON.parse(String(init.body)) : null)
      return new Response('{}', { status: 200 })
    }
    if (url.includes('asaas.com/api/v3')) {
      const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, '')
      const headers = new Headers(init?.headers)
      const call: AsaasCall = { method, path, body: init?.body ? JSON.parse(String(init.body)) : null, key: headers.get('access_token') }
      world.asaas.push(call)
      if (world.networkDown.some((p) => path.startsWith(p))) throw new TypeError('network down') // a tentativa conta, mas sem resposta
      return world.asaasOverride?.(call) ?? asaasDefault(world, call)
    }
    return null
  })
}

// ── Autorização assinada ─────────────────────────────────────────────────────

export interface SignedOp { op: FoodOp; signature: string }

/** Autorização válida por padrão (emitida há 1 s, vence em 60 s, nonce e chave de idempotência novos). */
export async function signedOp(fields: Partial<FoodOp> & Pick<FoodOp, 'kind'>, secret = SIGNING_SECRET): Promise<SignedOp> {
  const now = Date.now()
  const op = {
    company_id: COMPANY_ID,
    owner_ref: OWNER_REF,
    nonce: uniq('nonce').padEnd(20, 'x'),
    issued_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
    idempotency_key: uniq('idem'),
    ...fields,
  } as FoodOp
  return { op, signature: await signFoodOp(op, secret) }
}

export const withdrawOp = async (amountCents: number, clearKey = CNPJ, fields: Partial<FoodOp> = {}) =>
  await signedOp({ kind: 'withdraw', amount_cents: amountCents, destination_digest: await destinationDigest(COMPANY_ID, clearKey), ...fields })

// ── Chamada ──────────────────────────────────────────────────────────────────

export interface CallOptions {
  /** Cabeçalho x-alber-food-key (padrão: o certo). null = sem cabeçalho. */
  key?: string | null
  /** Assinatura da autorização (cabeçalho x-food-op-signature). */
  signature?: string | null
  method?: string
  rawBody?: string
}

export async function call<D = undefined>(
  world: World,
  handler: (req: Request, deps: D) => Promise<Response>,
  body: unknown,
  opts: CallOptions = {},
  deps?: D,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.key !== null) headers['x-alber-food-key'] = opts.key ?? SERVICE_KEY
  if (opts.signature) headers['x-food-op-signature'] = opts.signature
  const restore = world.live ? () => {} : installWorld(world)
  try {
    const method = opts.method ?? 'POST'
    const req = new Request('http://localhost/fn', { method, headers, body: method === 'GET' ? undefined : (opts.rawBody ?? JSON.stringify(body)) })
    const res = await handler(req, deps as D)
    const text = await res.text()
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(text) } catch { /* corpo vazio */ }
    return { res, status: res.status, data }
  } finally {
    restore()
  }
}

/** Mantém o mundo instalado durante `fn` (para chamadas simultâneas com Promise.all). */
export async function withLiveWorld<T>(world: World, fn: () => Promise<T>): Promise<T> {
  const restore = installWorld(world)
  world.live = true
  try {
    return await fn()
  } finally {
    world.live = false
    restore()
  }
}

export const transfers = (w: World) => w.asaas.filter((c) => c.method === 'POST' && c.path === '/transfers')
export const foodOps = (w: World) => w.db.rows('food_ops')
export const txs = (w: World) => w.db.rows('transactions')
