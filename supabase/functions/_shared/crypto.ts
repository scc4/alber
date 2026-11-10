// Spec: /specs/05_security.md §7
// PIN:  SHA-256 em trânsito (app); no banco, HMAC-SHA256 com PEPPER do servidor (+ bcrypt do valor com pepper), em
//       public.user_credentials (tabela sem acesso por anon/authenticated). Nunca em app_metadata (iria no JWT).
// Resp: bcrypt do valor com pepper no banco; o texto normalizado fica CIFRADO (AES-GCM) só para montar as opções mascaradas
// CPF:  SHA-256 no banco (ver nota em guards: migração para HMAC com pepper)
// Pix/Asaas key: AES-256-GCM no banco

import { hashSync as bcryptHashFn, compareSync as bcryptCompareFn, genSaltSync } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'

const enc = new TextEncoder()

// ── SHA-256 ───────────────────────────────────────────────────────────────────

export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Pepper de credenciais (A2 da auditoria de 09/11/2026) ────────────────────────────────────────
// PIN de 6 dígitos tem 10^6 possibilidades: SHA-256 puro (ou bcrypt de SHA-256 puro) cai por força bruta assim que o banco
// vaza. O pepper (segredo do servidor, fora do banco) torna inútil a cópia do banco sozinha. Falha FECHADA: sem o segredo,
// nenhuma verificação nem gravação de credencial acontece.

function pepperBytes(): Uint8Array<ArrayBuffer> {
  const v = Deno.env.get('ALBER_CREDENTIAL_PEPPER') ?? ''
  if (v.length < 32) throw new Error('ALBER_CREDENTIAL_PEPPER ausente ou curto (mín. 32 caracteres)')
  return enc.encode(v)
}

/** HMAC-SHA256(pepper, `${domain}:${valueHex}`) em hexadecimal. `domain` separa PIN, resposta e senha de sessão. */
export async function pepperHex(domain: 'pin' | 'answer' | 'session' | 'cpf' | 'sms', valueHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', pepperBytes(), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${domain}:${valueHex}`))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Comparação em tempo constante de duas strings hexadecimais do mesmo tamanho. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Hash de identidade do CPF (somente dígitos): HMAC com pepper. users.cpf e pending_registrations.cpf_hash. O SHA-256 puro de um CPF
 *  (10^9 possibilidades) se recupera por força bruta em minutos; com o pepper, uma cópia do banco sozinha não basta. CNPJ é dado
 *  público de registro e segue em SHA-256 puro (companies.cnpj). */
export const cpfHash = (cpfDigits: string) => pepperHex('cpf', cpfDigits)
export const pinGuard    = (pinSha256Hex: string)    => pepperHex('pin', pinSha256Hex)
export const answerGuard = (answerSha256Hex: string) => pepperHex('answer', answerSha256Hex)
/** Senha que o Supabase Auth guarda para a conta: derivada no servidor, NUNCA do PIN. O cliente não a conhece. */
export const sessionPassword = (authId: string)      => pepperHex('session', authId)

/** O PIN (SHA-256 em hexadecimal, vindo do cliente) confere com o valor guardado (pin_hmac)? */
export async function pinMatches(pinSha256Hex: string, storedPinHmac: string): Promise<boolean> {
  return safeEqualHex(await pinGuard(pinSha256Hex), storedPinHmac)
}

/** O hash de resposta (SHA-256 em hexadecimal, vindo do cliente) confere com o bcrypt guardado? */
export async function verifyAnswerHash(answerSha256Hex: string, storedBcrypt: string): Promise<boolean> {
  return bcryptVerify(await answerGuard(answerSha256Hex), storedBcrypt)
}

/** Valor a guardar em security_questions.answer_hash (bcrypt do hash com pepper). */
export async function hashAnswerForStorage(answerSha256Hex: string): Promise<string> {
  return bcryptHash(await answerGuard(answerSha256Hex), 10)
}

/** Mesma normalização do app (utils/crypto.ts): minúsculas, sem acentos, sem espaços nas pontas. */
export function normalizeAnswerText(answer: string): string {
  return answer.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

/** Credenciais de PIN do usuário (tabela privada). `pinSha256` = pin_hmac (nome mantido para não mexer em todo o código). */
export interface PinCreds { pinBcrypt?: string; pinSha256?: string }

// deno-lint-ignore no-explicit-any
export async function loadPinCreds(supabaseAdmin: any, userId: string): Promise<PinCreds> {
  const { data } = await supabaseAdmin.from('user_credentials').select('pin_hmac, pin_bcrypt').eq('user_id', userId).maybeSingle()
  return { pinBcrypt: (data?.pin_bcrypt as string | undefined) ?? undefined, pinSha256: (data?.pin_hmac as string | undefined) ?? undefined }
}

/** Grava (ou troca) o PIN: `pinSha256Hex` é o SHA-256 do PIN enviado pelo cliente. */
// deno-lint-ignore no-explicit-any
export async function savePinCreds(supabaseAdmin: any, userId: string, pinSha256Hex: string): Promise<{ error: { message: string } | null }> {
  const guard = await pinGuard(pinSha256Hex)
  const { error } = await supabaseAdmin.from('user_credentials').upsert(
    { user_id: userId, pin_hmac: guard, pin_bcrypt: await bcryptHash(guard), updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  return { error: error ?? null }
}

// ── bcrypt ────────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12

export function bcryptHash(value: string, rounds = BCRYPT_ROUNDS): string {
  const salt = genSaltSync(rounds)
  return bcryptHashFn(value, salt)
}

export function bcryptVerify(value: string, hash: string): boolean {
  return bcryptCompareFn(value, hash)
}

// ── AES-256-GCM ──────────────────────────────────────────────────────────────
// Chave derivada via SHA-256 do segredo para garantir 256 bits.
// Saída: base64(iv[12] + ciphertext)

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function aesEncrypt(text: string, secret: string): Promise<string> {
  const key = await aesKey(secret)
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))
  const buf = new Uint8Array(12 + ct.byteLength)
  buf.set(iv)
  buf.set(new Uint8Array(ct), 12)
  return btoa(String.fromCharCode(...buf))
}

export async function aesDecrypt(encoded: string, secret: string): Promise<string> {
  const key = await aesKey(secret)
  const buf = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const iv  = buf.slice(0, 12)
  const ct  = buf.slice(12)
  const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

// ── PIN com pares (mode='secure') ────────────────────────────────────────────
// Gera todas as 2^6 = 64 combinações possíveis dos pares clicados e testa
// cada SHA-256 contra o hash armazenado. Custo total: ~64 × SHA-256 ≈ < 1ms.

function generateCombinations(pairs: number[][]): number[][] {
  if (pairs.length === 0) return [[]]
  const [first, ...rest] = pairs
  const restCombos = generateCombinations(rest)
  return first.flatMap((digit: number) => restCombos.map((combo: number[]) => [digit, ...combo]))
}

/**
 * Fallback para contas sem pin_sha256: testa os 64 combos contra o bcrypt armazenado.
 * Lento (~300ms × 64), mas auto-cura na primeira autenticação bem-sucedida.
 */
export async function verifyPinWithPairsBcryptFallback(
  pinBcrypt: string,
  pairs: number[][],
): Promise<{ ok: boolean; sha256: string | null }> {
  const combinations = generateCombinations(pairs)
  for (const combo of combinations) {
    const hash = await sha256hex(combo.join(''))
    if (await bcryptVerify(await pinGuard(hash), pinBcrypt)) {
      return { ok: true, sha256: hash }
    }
  }
  return { ok: false, sha256: null }
}

/**
 * Verifica se alguma combinação dos pares produz o SHA-256 armazenado.
 * Retorna ok=true e o sha256 correspondente (usado para criar sessão Supabase).
 */
export async function verifyPinWithPairs(
  storedSha256: string,
  pairs: number[][],
): Promise<{ ok: boolean; sha256: string | null }> {
  const combinations = generateCombinations(pairs)
  for (const combo of combinations) {
    const hash = await sha256hex(combo.join(''))
    if (safeEqualHex(await pinGuard(hash), storedSha256)) return { ok: true, sha256: hash }
  }
  return { ok: false, sha256: null }
}

/**
 * Detecta se o payload é JSON de pares (mode='secure') ou SHA-256 direto (mode='setup').
 * Retorna o array de pares se válido, null caso contrário.
 */
export function tryParsePairsPayload(pinHash: string): number[][] | null {
  try {
    const parsed = JSON.parse(pinHash)
    if (
      Array.isArray(parsed) &&
      parsed.length === 6 &&
      Array.isArray(parsed[0]) &&
      parsed[0].length === 2
    ) return parsed as number[][]
  } catch { /* não é JSON */ }
  return null
}

// ── HMAC-SHA256 (webhook validation) ─────────────────────────────────────────

export async function hmacVerify(payload: string, secret: string, received: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  const hex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  // Comparação em tempo constante
  return safeEqualHex(hex, received.toLowerCase())
}
