// Cifra das chaves de API das subcontas do Asaas (users.asaas_api_key_enc e companies.asaas_api_key_enc).
//
// Histórico: o segredo de cifra era o próprio ASAAS_API_KEY (a chave-mãe do Asaas). Isso amarra a troca da chave do Asaas, que expira por
// inatividade e só aparece uma vez ao ser gerada, à perda de todas as chaves de subconta já guardadas. Este módulo separa as duas coisas:
// a chave do Asaas volta a ser só uma credencial e as chaves de subconta passam a ter um segredo de cifra próprio, com versão.
//
// Formato novo:  `v2:<id>:<base64(iv[12] + ciphertext)>`  (AES-256-GCM, chave própria de 32 bytes, id da versão para rotação)
// Formato antigo (sem prefixo): base64(iv[12] + ciphertext), chave = SHA-256 do ASAAS_API_KEY. Continua legível, então publicar este
// código antes de definir o segredo novo não muda nada.
//
// Variáveis (Supabase secrets):
//   ALBER_KEYS_ENCRYPTION_KEY         32 bytes, base64 (44 caracteres) ou hexadecimal (64). Definida = tudo novo é gravado em v2.
//   ALBER_KEYS_ENCRYPTION_KEY_V       id da versão atual (padrão "1").
//   ALBER_KEYS_ENCRYPTION_KEY_PREV    versão anterior, só para LER durante uma rotação (com ALBER_KEYS_ENCRYPTION_KEY_PREV_V).
//   ALBER_KEYS_LEGACY_SECRET          valor ANTIGO do ASAAS_API_KEY. Permite trocar o ASAAS_API_KEY sem perder as linhas no formato antigo.
//
// Nenhuma mensagem de erro deste módulo contém segredo nem texto cifrado.

import { aesDecrypt, aesEncrypt } from './crypto.ts'

const enc = new TextEncoder()
/** Dados autenticados: amarra o texto cifrado a este uso (não decifra se for apresentado como outro tipo de dado). */
const AAD = enc.encode('alber:subaccount-key:v2')
const V2_PREFIX = 'v2:'
const V2_FORMAT = /^v2:([A-Za-z0-9_-]{1,16}):([A-Za-z0-9+/]+={0,2})$/
const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/

const INVALID_KEY = 'ALBER_KEYS_ENCRYPTION_KEY inválida: precisa ter 32 bytes (base64 de 44 caracteres ou hexadecimal de 64)'

function toBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/** 32 bytes a partir de base64 ou hexadecimal. Nunca inclui o valor na mensagem de erro. */
function parseKeyMaterial(value: string): Uint8Array<ArrayBuffer> {
  const v = value.trim()
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = /^[0-9a-fA-F]{64}$/.test(v) ? Uint8Array.from(v.match(/../g)!, (h) => parseInt(h, 16)) : toBytes(v)
  } catch {
    throw new Error(INVALID_KEY)
  }
  if (raw.length !== 32) throw new Error(INVALID_KEY)
  return raw
}

async function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

interface VersionedKey { id: string; key: CryptoKey }

async function readKey(valueName: string, versionName: string, defaultId: string | null): Promise<VersionedKey | null> {
  const value = Deno.env.get(valueName)
  if (!value || !value.trim()) return null
  const id = (Deno.env.get(versionName) ?? defaultId ?? '').trim()
  if (!KEY_ID.test(id)) throw new Error(`${versionName} inválido: use até 16 caracteres (letras, números, _ e -)`)
  return { id, key: await importAesKey(parseKeyMaterial(value)) }
}

const currentKey = () => readKey('ALBER_KEYS_ENCRYPTION_KEY', 'ALBER_KEYS_ENCRYPTION_KEY_V', '1')
const previousKey = () => readKey('ALBER_KEYS_ENCRYPTION_KEY_PREV', 'ALBER_KEYS_ENCRYPTION_KEY_PREV_V', null)

/** O formato novo já está ativo (existe o segredo próprio)? */
export function subaccountKeyV2Configured(): boolean {
  return !!Deno.env.get('ALBER_KEYS_ENCRYPTION_KEY')?.trim()
}

/** A linha guardada já está no formato novo? */
export function isSubaccountKeyV2(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(V2_PREFIX)
}

/** Cifra a chave de API de uma subconta. Sem o segredo próprio configurado, mantém o formato antigo (comportamento anterior). */
export async function encryptSubaccountKey(plain: string): Promise<string> {
  const cur = await currentKey()
  if (!cur) {
    const legacy = Deno.env.get('ASAAS_API_KEY')
    if (!legacy) throw new Error('SUBACCOUNT_KEY_NOT_CONFIGURED')
    return aesEncrypt(plain, legacy)
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, cur.key, enc.encode(plain)))
  const buf = new Uint8Array(iv.length + ct.length)
  buf.set(iv)
  buf.set(ct, iv.length)
  return `${V2_PREFIX}${cur.id}:${toBase64(buf)}`
}

/** Decifra a chave de API de uma subconta, no formato novo ou no antigo. */
export async function decryptSubaccountKey(stored: string): Promise<string> {
  if (!stored) throw new Error('SUBACCOUNT_KEY_EMPTY')

  if (stored.startsWith(V2_PREFIX)) {
    const m = V2_FORMAT.exec(stored)
    if (!m) throw new Error('SUBACCOUNT_KEY_MALFORMED')
    const [cur, prev] = [await currentKey(), await previousKey()]
    const found = cur && cur.id === m[1] ? cur : prev && prev.id === m[1] ? prev : null
    if (!found) throw new Error('SUBACCOUNT_KEY_UNKNOWN_VERSION')
    const buf = toBytes(m[2] as string)
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12), additionalData: AAD }, found.key, buf.slice(12))
      return new TextDecoder().decode(pt)
    } catch {
      throw new Error('SUBACCOUNT_KEY_DECRYPT_FAILED')
    }
  }

  // Formato antigo: primeiro o valor antigo guardado à parte (se o ASAAS_API_KEY foi trocado), depois o ASAAS_API_KEY de agora.
  const candidates = [Deno.env.get('ALBER_KEYS_LEGACY_SECRET'), Deno.env.get('ASAAS_API_KEY')].filter((s, i, all): s is string => !!s && all.indexOf(s) === i)
  if (candidates.length === 0) throw new Error('SUBACCOUNT_KEY_NOT_CONFIGURED')
  for (const secret of candidates) {
    try {
      return await aesDecrypt(stored, secret)
    } catch { /* tenta o próximo segredo */ }
  }
  throw new Error('SUBACCOUNT_KEY_DECRYPT_FAILED')
}
