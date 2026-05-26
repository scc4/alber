// Spec: /specs/05_security.md §7
// PIN:  SHA-256 em trânsito (app), bcrypt cost 12 no banco
// Resp: bcrypt cost 12 no banco
// CPF:  SHA-256 no banco
// Pix/Asaas key: AES-256-GCM no banco

import bcrypt from 'npm:bcryptjs@2.4.3'

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

export async function bcryptHash(value: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS)
  return bcrypt.hash(value, salt)
}

export function bcryptVerify(value: string, hash: string): Promise<boolean> {
  return bcrypt.compare(value, hash)
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
