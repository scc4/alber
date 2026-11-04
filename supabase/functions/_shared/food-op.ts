// Autorização assinada das operações do Alber Food que mexem em dinheiro, chave Pix ou titularidade (saque, chave Pix de saque, troca de
// titular). Plano: docs/plano-separacao-pf-pj.md §2.3 (repositório do Alber Food). Contrato completo: specs/06_modules/food_company_service.md.
//
// O Alber Food manda, junto da chamada de serviço (x-alber-food-key), um objeto `op` no corpo e a assinatura no cabeçalho
//   x-food-op-signature: v1=<hex do HMAC-SHA256 do JSON canônico de op>
// com o segredo FOOD_OP_SIGNING_KEY. Uma chave de serviço vazada sozinha, portanto, não saca. O Alber confere:
//   assinatura (tempo constante) -> formato -> validade (no máximo 120 s, ainda não vencida) -> amarração ao corpo (empresa, dono, valor,
//   destino, novo titular, tipo da operação) -> nonce nunca visto -> idempotência pela idempotency_key.
// Qualquer falha vira a MESMA resposta (403 INVALID_AUTHORIZATION), sem dizer qual verificação falhou; o motivo só vai para o log do servidor.
//
// JSON canônico: chaves em ordem alfabética (recursivo), sem espaços, valores como JSON.stringify os escreve. Chave do HMAC: os bytes do
// segredo decodificado (hexadecimal de 64+ caracteres ou base64; 32 bytes ou mais), NÃO o texto.
//
// Este arquivo tem duas partes: funções puras (assinar/verificar) e o armazém de nonces/idempotência (tabela food_ops, migration 058).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256hex } from './crypto.ts'

export type FoodOpKind = 'withdraw' | 'set_pix_key' | 'owner_transfer'

export interface FoodOp {
  kind: FoodOpKind
  company_id: string
  owner_ref: string
  /** Só saque: valor em centavos inteiros. */
  amount_cents?: number
  /** Saque (obrigatório) e chave Pix (opcional): SHA-256 hex de `${company_id}|${chave Pix em claro}`. */
  destination_digest?: string
  /** Só troca de titular: owner_ref do novo dono. */
  new_owner_ref?: string
  nonce: string
  issued_at: string
  expires_at: string
  idempotency_key: string
}

/** A autorização vale no máximo 2 minutos. */
export const FOOD_OP_MAX_TTL_MS = 120_000
/** Tolerância de relógio: issued_at pode estar até 60 s à frente do relógio do Alber. */
export const FOOD_OP_FUTURE_SKEW_MS = 60_000

const KINDS: readonly string[] = ['withdraw', 'set_pix_key', 'owner_transfer']
const OP_KEYS: readonly string[] = ['kind', 'company_id', 'owner_ref', 'amount_cents', 'destination_digest', 'new_owner_ref', 'nonce', 'issued_at', 'expires_at', 'idempotency_key']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NONCE = /^[A-Za-z0-9_-]{16,64}$/
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,64}$/
const DIGEST = /^[0-9a-f]{64}$/
const OWNER_REF = /^[\x21-\x7e]{1,128}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/
const SIGNATURE_HEADER = /^v1=([0-9a-fA-F]{64})$/

const enc = new TextEncoder()

// ── JSON canônico e assinatura ───────────────────────────────────────────────

/** Chaves em ordem alfabética (recursivo), sem espaços. Valores `undefined` somem, como em JSON.stringify. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>
    const parts: string[] = []
    for (const k of Object.keys(o).sort()) {
      if (o[k] === undefined) continue
      parts.push(`${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    }
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Bytes do segredo: hexadecimal (64+ caracteres, tamanho par) ou base64. Menos de 32 bytes = inválido (null). */
export function parseSigningKey(raw: string | undefined | null): Uint8Array<ArrayBuffer> | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  let bytes: Uint8Array<ArrayBuffer>
  try {
    if (/^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0 && v.length >= 64) bytes = Uint8Array.from(v.match(/../g)!, (h) => parseInt(h, 16))
    else bytes = Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
  return bytes.length >= 32 ? bytes : null
}

const hmacKey = (bytes: Uint8Array<ArrayBuffer>, usage: 'sign' | 'verify') => crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, [usage])

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

/** `v1=<hex>`: o que o Alber Food calcula (usado nos testes e no fake do Food). `secret` no mesmo formato de FOOD_OP_SIGNING_KEY. */
export async function signFoodOp(op: unknown, secret: string): Promise<string> {
  const bytes = parseSigningKey(secret)
  if (!bytes) throw new Error('FOOD_OP_SIGNING_KEY inválida: precisa ter 32 bytes ou mais (hexadecimal ou base64)')
  return `v1=${toHex(await crypto.subtle.sign('HMAC', await hmacKey(bytes, 'sign'), enc.encode(canonicalJson(op))))}`
}

/** Digest do destino de um saque: SHA-256 hex de `${company_id}|${chave Pix em claro}`. */
export const destinationDigest = (companyId: string, pixKeyClear: string): Promise<string> => sha256hex(`${companyId}|${pixKeyClear}`)

// ── Verificação ──────────────────────────────────────────────────────────────

/** O que a função que recebeu a chamada espera da autorização (tudo vem do corpo ou do que o Alber mesmo guarda). */
export interface FoodOpExpectation {
  kind: FoodOpKind
  companyId: string
  /** Dono que faz a operação (no corpo: owner_ref, ou from_owner_ref na troca de titular). */
  ownerRef: string
  /** Saque: valor do corpo, em centavos. */
  amountCents?: number
  /**
   * Saque: digest calculado do que o Alber guarda (obrigatório). Chave Pix: digest da chave que veio no corpo; se o corpo não traz a chave
   * (o Alber vai gerá-la), `null`, e a autorização não pode trazer digest.
   */
  destinationDigest?: string | null
  /** Troca de titular: owner_ref do novo dono, do corpo. */
  newOwnerRef?: string
}

export type FoodOpRejection =
  | 'not_configured' | 'missing_signature' | 'bad_signature_format' | 'bad_signature' | 'malformed' | 'unknown_field'
  | 'not_yet_valid' | 'expired' | 'ttl' | 'kind' | 'company' | 'owner' | 'amount' | 'destination' | 'new_owner'
  | 'reused'

export type FoodOpVerdict = { ok: true; op: FoodOp } | { ok: false; reason: FoodOpRejection }

const fail = (reason: FoodOpRejection): FoodOpVerdict => ({ ok: false, reason })

/** Compara em tempo constante (o que importa aqui é não vazar onde difere). */
function safeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a)
  const eb = enc.encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

/** Formato do objeto `op`: tipos, tamanhos, campos permitidos por tipo de operação. Não olha assinatura nem relógio. */
function parseOp(raw: unknown): FoodOp | FoodOpRejection {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return 'malformed'
  const o = raw as Record<string, unknown>
  if (Object.keys(o).some((k) => !OP_KEYS.includes(k))) return 'unknown_field'

  const { kind, company_id, owner_ref, amount_cents, destination_digest, new_owner_ref, nonce, issued_at, expires_at, idempotency_key } = o
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return 'malformed'
  if (typeof company_id !== 'string' || !UUID.test(company_id)) return 'malformed'
  if (typeof owner_ref !== 'string' || !OWNER_REF.test(owner_ref)) return 'malformed'
  if (typeof nonce !== 'string' || !NONCE.test(nonce)) return 'malformed'
  if (typeof idempotency_key !== 'string' || !IDEMPOTENCY_KEY.test(idempotency_key)) return 'malformed'
  if (typeof issued_at !== 'string' || !ISO.test(issued_at) || Number.isNaN(Date.parse(issued_at))) return 'malformed'
  if (typeof expires_at !== 'string' || !ISO.test(expires_at) || Number.isNaN(Date.parse(expires_at))) return 'malformed'

  if (amount_cents !== undefined && (typeof amount_cents !== 'number' || !Number.isSafeInteger(amount_cents) || amount_cents <= 0)) return 'malformed'
  if (destination_digest !== undefined && (typeof destination_digest !== 'string' || !DIGEST.test(destination_digest))) return 'malformed'
  if (new_owner_ref !== undefined && (typeof new_owner_ref !== 'string' || !OWNER_REF.test(new_owner_ref))) return 'malformed'

  // Cada tipo de operação carrega só o que lhe cabe: uma autorização de saque não serve de troca de titular, e vice-versa.
  if (kind === 'withdraw' && (amount_cents === undefined || destination_digest === undefined || new_owner_ref !== undefined)) return 'malformed'
  if (kind === 'set_pix_key' && (amount_cents !== undefined || new_owner_ref !== undefined)) return 'malformed'
  if (kind === 'owner_transfer' && (new_owner_ref === undefined || amount_cents !== undefined || destination_digest !== undefined)) return 'malformed'

  return { kind: kind as FoodOpKind, company_id, owner_ref, amount_cents, destination_digest, new_owner_ref, nonce, issued_at, expires_at, idempotency_key } as FoodOp
}

/**
 * Confere a autorização (tudo menos nonce e idempotência, que dependem do banco: ver reserveFoodOp). `secret` é o valor de
 * FOOD_OP_SIGNING_KEY (padrão: lido da variável de ambiente). Não lança.
 */
export async function verifyFoodOp(
  headers: Headers,
  rawOp: unknown,
  expected: FoodOpExpectation,
  now: Date = new Date(),
  secret: string | undefined | null = Deno.env.get('FOOD_OP_SIGNING_KEY'),
): Promise<FoodOpVerdict> {
  const keyBytes = parseSigningKey(secret)
  if (!keyBytes) return fail('not_configured')

  const header = headers.get('x-food-op-signature')
  if (!header) return fail('missing_signature')
  const m = SIGNATURE_HEADER.exec(header.trim())
  if (!m) return fail('bad_signature_format')
  const given = Uint8Array.from((m[1] as string).match(/../g)!, (h) => parseInt(h, 16))

  // 1) Assinatura sobre o objeto como chegou. crypto.subtle.verify compara em tempo constante.
  let signed: boolean
  try {
    signed = await crypto.subtle.verify('HMAC', await hmacKey(keyBytes, 'verify'), given, enc.encode(canonicalJson(rawOp)))
  } catch {
    return fail('bad_signature')
  }
  if (!signed) return fail('bad_signature')

  // 2) Formato.
  const parsed = parseOp(rawOp)
  if (typeof parsed === 'string') return fail(parsed)
  const op = parsed

  // 3) Validade: no máximo 120 s de vida, ainda não vencida, não emitida no futuro.
  const issued = Date.parse(op.issued_at)
  const expires = Date.parse(op.expires_at)
  if (expires <= issued || expires - issued > FOOD_OP_MAX_TTL_MS) return fail('ttl')
  if (now.getTime() >= expires) return fail('expired')
  if (issued > now.getTime() + FOOD_OP_FUTURE_SKEW_MS) return fail('not_yet_valid')

  // 4) Amarração ao corpo da chamada e ao que o Alber guarda.
  if (op.kind !== expected.kind) return fail('kind')
  if (op.company_id.toLowerCase() !== expected.companyId.toLowerCase()) return fail('company')
  if (!safeEqual(op.owner_ref, expected.ownerRef)) return fail('owner')
  if (op.kind === 'withdraw') {
    if (!Number.isSafeInteger(expected.amountCents) || op.amount_cents !== expected.amountCents) return fail('amount')
    if (!expected.destinationDigest || !safeEqual(op.destination_digest ?? '', expected.destinationDigest)) return fail('destination')
  }
  if (op.kind === 'set_pix_key') {
    // Com a chave no corpo, a autorização tem de ser da MESMA chave. Sem a chave (o Alber gera), a autorização não pode apontar para outra.
    if (expected.destinationDigest) {
      if (!safeEqual(op.destination_digest ?? '', expected.destinationDigest)) return fail('destination')
    } else if (op.destination_digest !== undefined) {
      return fail('destination')
    }
  }
  if (op.kind === 'owner_transfer' && (!expected.newOwnerRef || !safeEqual(op.new_owner_ref ?? '', expected.newOwnerRef))) return fail('new_owner')

  return { ok: true, op }
}

// ── Armazém: nonce e idempotência (tabela food_ops) ──────────────────────────

/** Desfecho guardado e devolvido de novo se a mesma operação for repetida. */
export type StoredResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | {
      ok: false
      status: number
      code: string
      message: string
      extra?: Record<string, unknown>
      /**
       * Nada aconteceu e repetir é seguro (falha passageira antes de qualquer efeito): a reserva é desfeita, e a mesma autorização (se ainda
       * válida) ou outra com a mesma idempotency_key pode tentar de novo. Sem isto o erro fica guardado e é devolvido nas repetições.
       */
      retryable?: boolean
      /**
       * Desfecho DESCONHECIDO (ex.: a chamada ao Asaas caiu sem resposta, o dinheiro pode ter saído): a reserva continua `in_progress` e as
       * repetições recebem OPERATION_IN_PROGRESS até a equipe reconciliar com a transação. Nunca fechar como falha nem liberar a chave.
       */
      leaveOpen?: boolean
    }

export type Reservation =
  | { kind: 'new'; id: string }
  | { kind: 'replay'; result: StoredResult }
  | { kind: 'in_progress' }
  | { kind: 'conflict' }
  | { kind: 'error' }

interface FoodOpRow {
  id: string
  nonce: string
  idempotency_key: string
  kind: string
  company_id: string
  owner_ref: string
  amount_cents: number | string | null
  destination_digest: string | null
  new_owner_ref: string | null
  status: 'in_progress' | 'completed' | 'failed'
  result: StoredResult | null
}

const ROW_COLUMNS = 'id, nonce, idempotency_key, kind, company_id, owner_ref, amount_cents, destination_digest, new_owner_ref, status, result'

function sameOperation(row: FoodOpRow, op: FoodOp): boolean {
  return row.kind === op.kind &&
    row.company_id.toLowerCase() === op.company_id.toLowerCase() &&
    row.owner_ref === op.owner_ref &&
    (row.amount_cents == null ? undefined : Number(row.amount_cents)) === op.amount_cents &&
    (row.destination_digest ?? undefined) === op.destination_digest &&
    (row.new_owner_ref ?? undefined) === op.new_owner_ref
}

function fromRow(row: FoodOpRow, op: FoodOp): Reservation {
  // Mesma idempotency_key com outro conteúdo: não é repetição, é reaproveitamento da chave (ou adulteração).
  if (!sameOperation(row, op)) return { kind: 'conflict' }
  if (row.status === 'in_progress' || !row.result) return { kind: 'in_progress' }
  return { kind: 'replay', result: row.result }
}

/**
 * Reserva a operação: grava o nonce e a idempotency_key como `in_progress`.
 *  - idempotency_key já existe com o mesmo conteúdo: repetição -> devolve o desfecho guardado (`replay`) ou `in_progress`;
 *  - idempotency_key já existe com outro conteúdo, ou nonce já usado por outra operação: `conflict`;
 *  - senão, `new` (quem chamou executa e fecha com finishFoodOp). Falha de banco = `error` (recusa: na dúvida, não opera).
 * Limpa de passagem as operações encerradas e vencidas.
 */
export async function reserveFoodOp(supabaseAdmin: SupabaseClient, op: FoodOp, now: Date = new Date()): Promise<Reservation> {
  try {
    await supabaseAdmin.from('food_ops').delete().lt('expires_at', now.toISOString()).neq('status', 'in_progress')
  } catch { /* limpeza é melhor esforço */ }

  const byKey = async (): Promise<{ row: FoodOpRow | null; failed: boolean }> => {
    const { data, error } = await supabaseAdmin.from('food_ops').select(ROW_COLUMNS).eq('idempotency_key', op.idempotency_key).maybeSingle()
    return error ? { row: null, failed: true } : { row: (data as FoodOpRow | null) ?? null, failed: false }
  }

  const first = await byKey()
  if (first.failed) return { kind: 'error' }
  if (first.row) return fromRow(first.row, op)

  const { data, error } = await supabaseAdmin
    .from('food_ops')
    .insert({
      nonce: op.nonce,
      idempotency_key: op.idempotency_key,
      kind: op.kind,
      company_id: op.company_id,
      owner_ref: op.owner_ref,
      amount_cents: op.amount_cents ?? null,
      destination_digest: op.destination_digest ?? null,
      new_owner_ref: op.new_owner_ref ?? null,
      status: 'in_progress',
    })
    .select('id')
    .single()
  if (!error && data) return { kind: 'new', id: (data as { id: string }).id }

  if ((error as { code?: string } | null)?.code === '23505') {
    // Duas chamadas ao mesmo tempo com a mesma chave (a outra ganhou) ou nonce já usado por outra operação.
    const again = await byKey()
    if (again.failed) return { kind: 'error' }
    return again.row ? fromRow(again.row, op) : { kind: 'conflict' }
  }
  return { kind: 'error' }
}

/** Fecha a operação reservada com o desfecho. Falha retryable apaga a reserva (nada aconteceu). Devolve false se não conseguiu gravar. */
export async function finishFoodOp(supabaseAdmin: SupabaseClient, id: string, result: StoredResult): Promise<boolean> {
  try {
    if (!result.ok && result.leaveOpen) return true
    if (!result.ok && result.retryable) {
      const { error } = await supabaseAdmin.from('food_ops').delete().eq('id', id)
      return !error
    }
    const { error } = await supabaseAdmin
      .from('food_ops')
      .update({ status: result.ok ? 'completed' : 'failed', result, completed_at: new Date().toISOString() })
      .eq('id', id)
    return !error
  } catch {
    return false
  }
}
