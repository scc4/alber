// Roda com: deno test supabase/functions/_shared/credentials.test.ts --allow-env
//
// Pepper de credenciais (auditoria de 09/11/2026): PIN, resposta, senha de sessão e CPF deixam de ser SHA-256 puro no banco.
import { assert, assertEquals, assertNotEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  answerGuard, bcryptVerify, cpfHash, hashAnswerForStorage, normalizeAnswerText, pepperHex, pinGuard, pinMatches, safeEqualHex,
  sessionPassword, sha256hex, tryParsePairsPayload, verifyAnswerHash, verifyPinWithPairs,
} from './crypto.ts'

const PEPPER_A = 'pepper-A-pepper-A-pepper-A-pepper-A-0123'
const PEPPER_B = 'pepper-B-pepper-B-pepper-B-pepper-B-0123'
Deno.env.set('ALBER_CREDENTIAL_PEPPER', PEPPER_A)

Deno.test('o hash com pepper nunca é o SHA-256 puro e depende do segredo do servidor', async () => {
  const cpf = '52998224725'
  const plain = await sha256hex(cpf)
  const a = await cpfHash(cpf)
  assertNotEquals(a, plain)
  assertEquals(a, await cpfHash(cpf)) // determinístico (serve de índice de busca/unicidade)
  assertEquals(a.length, 64)
  Deno.env.set('ALBER_CREDENTIAL_PEPPER', PEPPER_B)
  try { assertNotEquals(await cpfHash(cpf), a) } finally { Deno.env.set('ALBER_CREDENTIAL_PEPPER', PEPPER_A) }
})

Deno.test('domínios separados: o mesmo valor gera hashes diferentes para PIN, resposta, CPF e senha de sessão', async () => {
  const v = 'f'.repeat(64)
  const all = await Promise.all([pinGuard(v), answerGuard(v), cpfHash(v), sessionPassword(v)])
  assertEquals(new Set(all).size, 4)
})

Deno.test('falha FECHADA sem o pepper (ausente ou curto): nenhuma credencial é calculada', async () => {
  for (const bad of [undefined, '', 'curto']) {
    if (bad === undefined) Deno.env.delete('ALBER_CREDENTIAL_PEPPER'); else Deno.env.set('ALBER_CREDENTIAL_PEPPER', bad)
    try {
      await assertRejects(() => pinGuard('x'), Error, 'ALBER_CREDENTIAL_PEPPER')
      await assertRejects(() => cpfHash('52998224725'), Error)
      await assertRejects(() => sessionPassword('id'), Error)
    } finally { Deno.env.set('ALBER_CREDENTIAL_PEPPER', PEPPER_A) }
  }
})

Deno.test('PIN: confere pelo HMAC e recusa o SHA-256 puro e um PIN errado', async () => {
  const pin = await sha256hex('123456')
  const stored = await pinGuard(pin)
  assertEquals(await pinMatches(pin, stored), true)
  assertEquals(await pinMatches(await sha256hex('654321'), stored), false)
  assertEquals(await pinMatches(pin, pin), false) // quem tivesse só o SHA-256 do PIN não passa comparando com ele mesmo
})

Deno.test('PIN em pares (teclado embaralhado): testa as 64 combinações contra o HMAC guardado', async () => {
  const stored = await pinGuard(await sha256hex('123456'))
  const pairs = [[1, 9], [2, 8], [3, 7], [4, 6], [5, 0], [6, 1]] // cada par tem o dígito certo
  assertEquals((await verifyPinWithPairs(stored, pairs)).ok, true)
  assertEquals((await verifyPinWithPairs(stored, [[9, 8], [8, 7], [7, 6], [6, 5], [5, 4], [4, 3]])).ok, false)
  assertEquals(tryParsePairsPayload(JSON.stringify(pairs))?.length, 6)
})

Deno.test('resposta: bcrypt do hash COM pepper; o SHA-256 puro da resposta não confere com o que está no banco', async () => {
  const sha = await sha256hex(normalizeAnswerText('João '))
  assertEquals(normalizeAnswerText('João '), 'joao') // minúsculas, sem acento, sem espaços (igual ao app)
  const stored = await hashAnswerForStorage(sha)
  assertEquals(await verifyAnswerHash(sha, stored), true)
  assertEquals(await verifyAnswerHash(await sha256hex('maria'), stored), false)
  assertEquals(bcryptVerify(sha, stored), false) // sem o pepper o hash do banco não serve para testar palpites
})

Deno.test('safeEqualHex: tamanhos diferentes ou vazio nunca conferem', () => {
  assertEquals(safeEqualHex('ab', 'abc'), false)
  assertEquals(safeEqualHex('', ''), false)
  assert(safeEqualHex('abcdef', 'abcdef'))
  assertEquals(safeEqualHex('abcdef', 'abcdeg'), false)
})

Deno.test('pepperHex é HMAC-SHA256 em hexadecimal (64 caracteres)', async () => {
  assert(/^[0-9a-f]{64}$/.test(await pepperHex('pin', 'x')))
})
