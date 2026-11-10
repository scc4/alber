// Código SMS de confirmação (troca de PIN, exclusão de conta): gerado com aleatoriedade segura, guardado só como HMAC com pepper
// (nunca em texto puro) e verificado com tempo constante e no máximo SMS_MAX_ATTEMPTS erros por código.
// Auditoria de 09/11/2026: antes era Math.random(), texto puro em sms_codes.code e sem limite de tentativas (10^6 códigos em 10 min).
import { pepperHex, safeEqualHex } from './crypto.ts'

export const SMS_MAX_ATTEMPTS = 5
export const SMS_TTL_MS = 10 * 60_000

/** 6 dígitos com aleatoriedade criptográfica (sem viés de módulo). */
export function newSmsCode(): string {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x1_0000_0000 / 900_000) * 900_000
  do { crypto.getRandomValues(buf) } while (buf[0] >= limit)
  return String(100_000 + (buf[0] % 900_000))
}

/** HMAC com pepper, preso ao usuário e à finalidade: o mesmo código não vale para outro usuário nem outra operação. */
export const smsCodeHash = (userId: string, purpose: string, code: string) => pepperHex('sms', `${userId}:${purpose}:${code}`)

export type SmsCheck = 'ok' | 'expired' | 'invalid'

// deno-lint-ignore no-explicit-any
export async function checkSmsCode(supabaseAdmin: any, userId: string, purpose: string, rawCode: unknown): Promise<SmsCheck> {
  const now = new Date().toISOString()
  const { data: row } = await supabaseAdmin
    .from('sms_codes')
    .select('id, code_hash, attempts')
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .is('used_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!row || typeof row.code_hash !== 'string' || (row.attempts ?? 0) >= SMS_MAX_ATTEMPTS) return 'expired'

  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  const matches = /^\d{6}$/.test(code) && safeEqualHex(row.code_hash, await smsCodeHash(userId, purpose, code))
  if (!matches) {
    // Conta o erro; na última tentativa o código é queimado (precisa pedir outro).
    const attempts = (row.attempts ?? 0) + 1
    await supabaseAdmin.from('sms_codes').update({ attempts, ...(attempts >= SMS_MAX_ATTEMPTS ? { used_at: now } : {}) }).eq('id', row.id).is('used_at', null)
    return 'invalid'
  }
  // Uso único: só um pedido consegue marcar o código como usado.
  const { data: used } = await supabaseAdmin.from('sms_codes').update({ used_at: now }).eq('id', row.id).is('used_at', null).select('id')
  return Array.isArray(used) && used.length === 1 ? 'ok' : 'expired'
}
