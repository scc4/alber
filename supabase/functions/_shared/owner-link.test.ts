// Roda com: deno test supabase/functions/_shared/owner-link.test.ts --allow-env --allow-net
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { evaluateOwnerCpf, fetchCnpjRegistry, isAdminQualification, reviewFor, verifyOwnerCpfHash, type CnpjRegistry } from './owner-link.ts'
import { sha256hex, cpfHash } from './crypto.ts'
Deno.env.set('ALBER_CREDENTIAL_PEPPER', 'test-pepper-test-pepper-test-pepper-0123')

const CPF = '12345678909' // dígitos 4 a 9: 456789
const reg = (over: Partial<CnpjRegistry> = {}): CnpjRegistry => ({
  situation: 'ATIVA',
  legalName: 'X LTDA',
  partners: [{ name: 'QUALQUER NOME', cpfMask: '***456789**', role: 'Sócio-Administrador' }],
  ...over,
})

Deno.test('dígitos 4 a 9 batem com um sócio-administrador: match, qualquer que seja o nome', () => {
  assertEquals(evaluateOwnerCpf(CPF, reg()), { check: 'match', qualification: 'Sócio-Administrador' })
})

Deno.test('os 3 primeiros e os 2 últimos dígitos do CPF não entram na comparação', () => {
  assertEquals(evaluateOwnerCpf('99945678900', reg()).check, 'match')
})

Deno.test('sócio sem poderes de administração: partner (revisão), não match', () => {
  const r = reg({ partners: [{ name: 'A', cpfMask: '***456789**', role: 'Sócio Pessoa Física Residente no Brasil' }] })
  assertEquals(evaluateOwnerCpf(CPF, r), { check: 'partner', qualification: 'Sócio Pessoa Física Residente no Brasil' })
})

Deno.test('entre vários sócios, o administrador vence o sócio comum com os mesmos dígitos', () => {
  const r = reg({ partners: [{ name: 'A', cpfMask: '***456789**', role: 'Sócio' }, { name: 'B', cpfMask: '***456789**', role: 'Administrador' }] })
  assertEquals(evaluateOwnerCpf(CPF, r), { check: 'match', qualification: 'Administrador' })
})

Deno.test('ninguém com esses dígitos: mismatch', () => {
  assertEquals(evaluateOwnerCpf(CPF, reg({ partners: [{ name: 'A', cpfMask: '***456780**', role: 'Sócio-Administrador' }] })).check, 'mismatch')
  assertEquals(evaluateOwnerCpf('98765432100', reg()).check, 'mismatch')
})

Deno.test('máscara em formato estranho (pessoa jurídica, vazio) nunca confere', () => {
  const r = reg({ partners: [{ name: 'A', cpfMask: '**.456.789/****', role: 'Sócio-Administrador' }, { name: 'B', cpfMask: '', role: 'Sócio-Administrador' }] })
  assertEquals(evaluateOwnerCpf(CPF, r).check, 'mismatch')
})

Deno.test('CNPJ que não está ATIVA: inactive, mesmo com o sócio certo', () => {
  assertEquals(evaluateOwnerCpf(CPF, reg({ situation: 'BAIXADA' })).check, 'inactive')
})

Deno.test('MEI: o CPF inteiro na razão social tem de ser igual', () => {
  assertEquals(evaluateOwnerCpf(CPF, reg({ legalName: 'FULANO DE TAL 12345678909', partners: [] })).check, 'match')
  assertEquals(evaluateOwnerCpf(CPF, reg({ legalName: 'FULANO DE TAL 99945678900', partners: [] })).check, 'mismatch')
})

Deno.test('sem consulta, sem quadro societário ou CPF incompleto: unavailable', () => {
  assertEquals(evaluateOwnerCpf(CPF, null).check, 'unavailable')
  assertEquals(evaluateOwnerCpf(CPF, reg({ partners: [] })).check, 'unavailable')
  assertEquals(evaluateOwnerCpf('123', reg()).check, 'unavailable')
})

Deno.test('qualificações com poderes de administração', () => {
  for (const q of ['Sócio-Administrador', 'Administrador', 'Diretor', 'Presidente', 'Sócio-Gerente', 'Sócio Ostensivo', 'Titular Pessoa Física Residente ou Domiciliado no Brasil', 'ADMINISTRADOR']) assertEquals(isAdminQualification(q), true, q)
  for (const q of ['Sócio', 'Sócio Pessoa Física Residente no Brasil', 'Conselheiro de Administração', 'Procurador', 'Tesoureiro', '']) assertEquals(isAdminQualification(q), false, q)
})

Deno.test('só match libera sozinho; tudo o mais vai para a revisão', () => {
  assertEquals(reviewFor('match'), 'not_needed')
  for (const c of ['partner', 'mismatch', 'inactive', 'unavailable', 'unchecked'] as const) assertEquals(reviewFor(c), 'pending', c)
})

Deno.test('o CPF digitado tem de ser o da conta (hash), válido e completo', async () => {
  const hash = await cpfHash(CPF)
  assertEquals(await verifyOwnerCpfHash('123.456.789-09', hash), { ok: true, cpf: CPF })
  assertEquals(await verifyOwnerCpfHash('529.982.247-25', hash), { ok: false, code: 'OWNER_CPF_MISMATCH' }) // válido, mas de outra pessoa
  assertEquals(await verifyOwnerCpfHash('111.111.111-11', hash), { ok: false, code: 'CPF_INVALID' })
  assertEquals(await verifyOwnerCpfHash(undefined, hash), { ok: false, code: 'CPF_INVALID' })
  assertEquals(await verifyOwnerCpfHash(CPF, null), { ok: false, code: 'OWNER_CPF_MISMATCH' })
})

const api = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

Deno.test('fetchCnpjRegistry lê situação, razão social e sócios; falha vira null sem lançar', async () => {
  const r = await fetchCnpjRegistry('1', api({ descricao_situacao_cadastral: 'Ativa', razao_social: 'X LTDA', qsa: [{ nome_socio: 'Ana', cnpj_cpf_do_socio: '***456789**', qualificacao_socio: 'Sócio-Administrador' }, { nome_socio: '' }] }))
  assertEquals(r, { situation: 'ATIVA', legalName: 'X LTDA', partners: [{ name: 'Ana', cpfMask: '***456789**', role: 'Sócio-Administrador' }] })
  assertEquals(await fetchCnpjRegistry('1', api({}, false)), null)
  assertEquals(await fetchCnpjRegistry('1', api({ razao_social: 'X' })), null)
  assertEquals(await fetchCnpjRegistry('1', (async () => { throw new Error('rede') }) as unknown as typeof fetch), null)
})
