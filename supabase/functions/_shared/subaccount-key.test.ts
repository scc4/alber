// Unit tests — cifra própria das chaves de subconta (formato v2, formato antigo, rotação)
// Roda com: deno test supabase/functions/_shared/subaccount-key.test.ts --allow-env --allow-net

import { assertEquals, assertRejects, assertNotEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { aesEncrypt } from './crypto.ts'
import { decryptSubaccountKey, encryptSubaccountKey, isSubaccountKeyV2, subaccountKeyV2Configured } from './subaccount-key.ts'

const NAMES = [
  'ASAAS_API_KEY', 'ALBER_KEYS_ENCRYPTION_KEY', 'ALBER_KEYS_ENCRYPTION_KEY_V',
  'ALBER_KEYS_ENCRYPTION_KEY_PREV', 'ALBER_KEYS_ENCRYPTION_KEY_PREV_V', 'ALBER_KEYS_LEGACY_SECRET',
]
const SUB_KEY = '$aact_hmlg_000-chave-da-subconta-de-teste'
const b64 = (n: number, fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)))
const hex = (fill: number) => new Uint8Array(32).fill(fill).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
const K1 = b64(32, 1)
const K2 = b64(32, 2)

/** Cada teste parte do ambiente limpo e restaura no fim. */
async function withEnv(env: Record<string, string>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(NAMES.map((n) => [n, Deno.env.get(n)]))
  NAMES.forEach((n) => Deno.env.delete(n))
  Object.entries(env).forEach(([k, v]) => Deno.env.set(k, v))
  try { await fn() } finally {
    NAMES.forEach((n) => { const v = saved[n]; if (v === undefined) Deno.env.delete(n); else Deno.env.set(n, v) })
  }
}

Deno.test('sem o segredo próprio: continua gravando no formato antigo, com o ASAAS_API_KEY', async () => {
  await withEnv({ ASAAS_API_KEY: 'chave-mae-antiga' }, async () => {
    assertEquals(subaccountKeyV2Configured(), false)
    const stored = await encryptSubaccountKey(SUB_KEY)
    assertEquals(isSubaccountKeyV2(stored), false)
    assertEquals(await decryptSubaccountKey(stored), SUB_KEY)
    // é exatamente o formato que o código antigo gravava
    assertEquals(await decryptSubaccountKey(await aesEncrypt(SUB_KEY, 'chave-mae-antiga')), SUB_KEY)
  })
})

Deno.test('com o segredo próprio: grava v2 com o id da versão e não depende do ASAAS_API_KEY', async () => {
  await withEnv({ ASAAS_API_KEY: 'qualquer', ALBER_KEYS_ENCRYPTION_KEY: K1 }, async () => {
    const stored = await encryptSubaccountKey(SUB_KEY)
    assertEquals(isSubaccountKeyV2(stored), true)
    assertEquals(stored.startsWith('v2:1:'), true)
    assertEquals(await decryptSubaccountKey(stored), SUB_KEY)
    assertNotEquals(await encryptSubaccountKey(SUB_KEY), stored) // IV aleatório
    assertEquals(stored.includes(SUB_KEY), false)
    // trocar o ASAAS_API_KEY não afeta o formato novo
    Deno.env.set('ASAAS_API_KEY', 'outra-chave-mae-completamente-diferente')
    assertEquals(await decryptSubaccountKey(stored), SUB_KEY)
  })
})

Deno.test('aceita o segredo em hexadecimal e usa o id de versão configurado', async () => {
  await withEnv({ ALBER_KEYS_ENCRYPTION_KEY: hex(7), ALBER_KEYS_ENCRYPTION_KEY_V: 'abr26' }, async () => {
    const stored = await encryptSubaccountKey(SUB_KEY)
    assertEquals(stored.startsWith('v2:abr26:'), true)
    assertEquals(await decryptSubaccountKey(stored), SUB_KEY)
  })
})

Deno.test('com o segredo próprio ativo, linhas no formato antigo ainda são lidas (publicação gradual)', async () => {
  await withEnv({ ASAAS_API_KEY: 'chave-mae-antiga', ALBER_KEYS_ENCRYPTION_KEY: K1 }, async () => {
    const legacyRow = await aesEncrypt(SUB_KEY, 'chave-mae-antiga')
    assertEquals(await decryptSubaccountKey(legacyRow), SUB_KEY)
  })
})

Deno.test('trocar o ASAAS_API_KEY sem perder linhas antigas: ALBER_KEYS_LEGACY_SECRET guarda o valor de antes', async () => {
  const legacyRow = await aesEncrypt(SUB_KEY, 'chave-mae-antiga')
  await withEnv({ ASAAS_API_KEY: 'chave-mae-NOVA' }, async () => {
    await assertRejects(() => decryptSubaccountKey(legacyRow), Error, 'SUBACCOUNT_KEY_DECRYPT_FAILED')
  })
  await withEnv({ ASAAS_API_KEY: 'chave-mae-NOVA', ALBER_KEYS_LEGACY_SECRET: 'chave-mae-antiga' }, async () => {
    assertEquals(await decryptSubaccountKey(legacyRow), SUB_KEY)
  })
})

Deno.test('rotação: a versão anterior só lê, a atual grava', async () => {
  let oldRow = ''
  await withEnv({ ALBER_KEYS_ENCRYPTION_KEY: K1, ALBER_KEYS_ENCRYPTION_KEY_V: '1' }, async () => { oldRow = await encryptSubaccountKey(SUB_KEY) })

  // sem a versão anterior configurada, a linha antiga não abre
  await withEnv({ ALBER_KEYS_ENCRYPTION_KEY: K2, ALBER_KEYS_ENCRYPTION_KEY_V: '2' }, async () => {
    await assertRejects(() => decryptSubaccountKey(oldRow), Error, 'SUBACCOUNT_KEY_UNKNOWN_VERSION')
  })

  await withEnv({
    ALBER_KEYS_ENCRYPTION_KEY: K2, ALBER_KEYS_ENCRYPTION_KEY_V: '2',
    ALBER_KEYS_ENCRYPTION_KEY_PREV: K1, ALBER_KEYS_ENCRYPTION_KEY_PREV_V: '1',
  }, async () => {
    assertEquals(await decryptSubaccountKey(oldRow), SUB_KEY)
    const fresh = await encryptSubaccountKey(SUB_KEY)
    assertEquals(fresh.startsWith('v2:2:'), true)
    assertEquals(await decryptSubaccountKey(fresh), SUB_KEY)
  })
})

Deno.test('segredo errado, texto adulterado e formato inválido falham sem vazar nada', async () => {
  let stored = ''
  await withEnv({ ALBER_KEYS_ENCRYPTION_KEY: K1 }, async () => { stored = await encryptSubaccountKey(SUB_KEY) })

  await withEnv({ ALBER_KEYS_ENCRYPTION_KEY: K2 }, async () => { // mesma versão "1", segredo diferente
    await assertRejects(() => decryptSubaccountKey(stored), Error, 'SUBACCOUNT_KEY_DECRYPT_FAILED')
  })
  await withEnv({ ALBER_KEYS_ENCRYPTION_KEY: K1 }, async () => {
    const tampered = stored.slice(0, -6) + (stored.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA')
    await assertRejects(() => decryptSubaccountKey(tampered), Error)
    await assertRejects(() => decryptSubaccountKey('v2:1:@@@'), Error, 'SUBACCOUNT_KEY_MALFORMED')
    await assertRejects(() => decryptSubaccountKey(''), Error, 'SUBACCOUNT_KEY_EMPTY')
  })
})

Deno.test('separação de uso: um texto v2 não abre como formato antigo e vice-versa', async () => {
  await withEnv({ ASAAS_API_KEY: 'chave-mae', ALBER_KEYS_ENCRYPTION_KEY: K1 }, async () => {
    const v2 = await encryptSubaccountKey(SUB_KEY)
    const withoutPrefix = v2.split(':')[2] as string // o mesmo conteúdo, apresentado como formato antigo
    await assertRejects(() => decryptSubaccountKey(withoutPrefix), Error, 'SUBACCOUNT_KEY_DECRYPT_FAILED')
  })
})

Deno.test('segredo próprio inválido é recusado sem mostrar o valor', async () => {
  for (const bad of ['curto', btoa('x'.repeat(16)), 'a'.repeat(63), '!!!não-é-base64!!!']) {
    await withEnv({ ALBER_KEYS_ENCRYPTION_KEY: bad }, async () => {
      const err = await assertRejects(() => encryptSubaccountKey(SUB_KEY), Error)
      assertStringIncludes(err.message, 'ALBER_KEYS_ENCRYPTION_KEY inválida')
      assertEquals(err.message.includes(bad), false)
    })
  }
  await withEnv({ ALBER_KEYS_ENCRYPTION_KEY: K1, ALBER_KEYS_ENCRYPTION_KEY_V: 'id com espaço' }, async () => {
    await assertRejects(() => encryptSubaccountKey(SUB_KEY), Error, 'ALBER_KEYS_ENCRYPTION_KEY_V inválido')
  })
})

Deno.test('nada configurado: erro claro, sem gravar em branco', async () => {
  const legacyRow = await aesEncrypt(SUB_KEY, 'x')
  await withEnv({}, async () => {
    await assertRejects(() => encryptSubaccountKey(SUB_KEY), Error, 'SUBACCOUNT_KEY_NOT_CONFIGURED')
    await assertRejects(() => decryptSubaccountKey(legacyRow), Error, 'SUBACCOUNT_KEY_NOT_CONFIGURED')
  })
})
