// Atestado de liberação do Alber Food: "a equipe Alber conferiu este responsável contra este CNPJ".
// Plano: docs/plano-onboarding-verificacao-manual.md (repositório do Alber Food), fase A.
//
// No novo onboarding a subconta do Asaas só pode ser criada depois que a equipe libera o pedido de conta de recebimento. O Alber Food assina um
// atestado no momento de abrir a conta e o `food-company-create` o exige: uma chave de serviço vazada sozinha não cria subconta nenhuma.
//
// Mesma chave e mesma forma da autorização de saque (food-op.ts): HMAC-SHA256 do JSON canônico, cabeçalho
//   x-food-release-signature: v1=<hex>
// com FOOD_OP_SIGNING_KEY (bytes do segredo decodificado). Vale no máximo 120 s. Sem nonce guardado: repetir o atestado dentro da validade só
// devolve a empresa que já existe (food-company-create é idempotente por dono e CNPJ), então não há o que repetir de efeito.
//
// O atestado amarra: o dono (owner_ref), o CNPJ (SHA-256 do CNPJ só com dígitos) e o CPF do responsável (SHA-256 dos 11 dígitos), todos
// conferidos contra o corpo da chamada. Qualquer falha vira a MESMA resposta 403 INVALID_AUTHORIZATION; o motivo só vai para o log.

import { canonicalJson, FOOD_OP_FUTURE_SKEW_MS, FOOD_OP_MAX_TTL_MS, parseSigningKey } from './food-op.ts'

export interface ReleaseAttestation {
  kind: 'company_release'
  /** Id do pedido liberado no Alber Food (rastreio; o Alber não o interpreta). */
  request_id: string
  owner_ref: string
  /** SHA-256 hex do CNPJ só com dígitos. */
  cnpj_hash: string
  /** SHA-256 hex do CPF do responsável só com dígitos. */
  cpf_hash: string
  /** Quando a equipe liberou. */
  decided_at: string
  nonce: string
  issued_at: string
  expires_at: string
}

export interface ReleaseExpectation {
  ownerRef: string
  cnpjHash: string
  cpfHash: string
}

export type ReleaseRejection =
  | 'not_configured' | 'missing_signature' | 'bad_signature_format' | 'bad_signature' | 'malformed'
  | 'not_yet_valid' | 'expired' | 'ttl' | 'owner' | 'cnpj' | 'cpf'

export type ReleaseVerdict = { ok: true; release: ReleaseAttestation } | { ok: false; reason: ReleaseRejection }

const KEYS: readonly string[] = ['kind', 'request_id', 'owner_ref', 'cnpj_hash', 'cpf_hash', 'decided_at', 'nonce', 'issued_at', 'expires_at']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
const NONCE = /^[A-Za-z0-9_-]{16,64}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/
const SIGNATURE_HEADER = /^v1=([0-9a-fA-F]{64})$/
const enc = new TextEncoder()

const fail = (reason: ReleaseRejection): ReleaseVerdict => ({ ok: false, reason })
const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

/** `v1=<hex>`: o que o Alber Food calcula (usado nos testes). `secret` no mesmo formato de FOOD_OP_SIGNING_KEY. */
export async function signRelease(release: unknown, secret: string): Promise<string> {
  const bytes = parseSigningKey(secret)
  if (!bytes) throw new Error('FOOD_OP_SIGNING_KEY inválida: precisa ter 32 bytes ou mais (hexadecimal ou base64)')
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `v1=${toHex(await crypto.subtle.sign('HMAC', key, enc.encode(canonicalJson(release))))}`
}

function safeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a)
  const eb = enc.encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

function parse(raw: unknown): ReleaseAttestation | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).length !== KEYS.length || !Object.keys(o).every((k) => KEYS.includes(k))) return null
  const { kind, request_id, owner_ref, cnpj_hash, cpf_hash, decided_at, nonce, issued_at, expires_at } = o
  if (kind !== 'company_release') return null
  if (typeof request_id !== 'string' || !UUID.test(request_id)) return null
  if (typeof owner_ref !== 'string' || owner_ref.length < 1 || owner_ref.length > 128) return null
  if (typeof cnpj_hash !== 'string' || !HASH.test(cnpj_hash)) return null
  if (typeof cpf_hash !== 'string' || !HASH.test(cpf_hash)) return null
  if (typeof nonce !== 'string' || !NONCE.test(nonce)) return null
  for (const d of [decided_at, issued_at, expires_at]) if (typeof d !== 'string' || !ISO.test(d) || Number.isNaN(Date.parse(d))) return null
  return o as unknown as ReleaseAttestation
}

/** Confere assinatura, formato, validade e amarração ao corpo. Não lança. */
export async function verifyRelease(
  headers: Headers,
  raw: unknown,
  expected: ReleaseExpectation,
  now: Date = new Date(),
  secret: string | undefined | null = Deno.env.get('FOOD_OP_SIGNING_KEY'),
): Promise<ReleaseVerdict> {
  const keyBytes = parseSigningKey(secret)
  if (!keyBytes) return fail('not_configured')
  const header = headers.get('x-food-release-signature')
  if (!header) return fail('missing_signature')
  const m = SIGNATURE_HEADER.exec(header.trim())
  if (!m) return fail('bad_signature_format')
  const given = Uint8Array.from((m[1] as string).match(/../g)!, (h) => parseInt(h, 16))
  let signed: boolean
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    signed = await crypto.subtle.verify('HMAC', key, given, enc.encode(canonicalJson(raw)))
  } catch {
    return fail('bad_signature')
  }
  if (!signed) return fail('bad_signature')

  const release = parse(raw)
  if (!release) return fail('malformed')
  const issued = Date.parse(release.issued_at)
  const expires = Date.parse(release.expires_at)
  if (expires <= issued || expires - issued > FOOD_OP_MAX_TTL_MS) return fail('ttl')
  if (now.getTime() >= expires) return fail('expired')
  if (issued > now.getTime() + FOOD_OP_FUTURE_SKEW_MS) return fail('not_yet_valid')
  if (!safeEqual(release.owner_ref, expected.ownerRef)) return fail('owner')
  if (!safeEqual(release.cnpj_hash, expected.cnpjHash)) return fail('cnpj')
  if (!safeEqual(release.cpf_hash, expected.cpfHash)) return fail('cpf')
  return { ok: true, release }
}
