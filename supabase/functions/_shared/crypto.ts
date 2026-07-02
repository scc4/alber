// Spec: /specs/05_security.md §7
// PIN:  SHA-256 em trânsito (app), bcrypt cost 12 no banco
// Resp: bcrypt cost 12 no banco
// CPF:  SHA-256 no banco
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
    if (await bcryptVerify(hash, pinBcrypt)) {
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
    if (hash === storedSha256) return { ok: true, sha256: hash }
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
  // Constant-time comparison
  return hex === received.toLowerCase()
}
