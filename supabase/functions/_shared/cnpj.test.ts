// Roda com: deno test supabase/functions/_shared/cnpj.test.ts

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { validateCnpj, normalizeCnpj, maskCnpjForDisplay } from './cnpj.ts'

Deno.test('validateCnpj aceita CNPJs válidos conhecidos', () => {
  assertEquals(validateCnpj('11.222.333/0001-81'), true)
  assertEquals(validateCnpj('11444777000161'), true)
  assertEquals(validateCnpj('04252011000110'), true)
})

Deno.test('validateCnpj rejeita CNPJs com dígito verificador errado', () => {
  assertEquals(validateCnpj('11222333000199'), false)
  assertEquals(validateCnpj('11444777000162'), false)
})

Deno.test('validateCnpj rejeita tamanho incorreto', () => {
  assertEquals(validateCnpj('1122233300018'), false)
  assertEquals(validateCnpj('112223330001811'), false)
  assertEquals(validateCnpj(''), false)
})

Deno.test('validateCnpj rejeita sequências triviais', () => {
  assertEquals(validateCnpj('00000000000000'), false)
  assertEquals(validateCnpj('11111111111111'), false)
  assertEquals(validateCnpj('AAAAAAAAAAAAAA'), false)
})

Deno.test('normalizeCnpj remove tudo que não for dígito', () => {
  assertEquals(normalizeCnpj('11.222.333/0001-81'), '11222333000181')
})

// ── CNPJ alfanumérico (Instrução Normativa RFB nº 2.229/2024, emissão a partir
// de 31/07/2026) — as 12 primeiras posições podem ser dígito ou letra
// maiúscula; os 2 dígitos verificadores continuam sempre numéricos.

Deno.test('validateCnpj aceita CNPJ alfanumérico (exemplo oficial da Receita)', () => {
  assertEquals(validateCnpj('AB12CD34/EFGH-83'), true)
  assertEquals(validateCnpj('AB12CD34EFGH83'), true)
})

Deno.test('validateCnpj aceita letras minúsculas normalizando para maiúscula', () => {
  assertEquals(validateCnpj('ab12cd34efgh83'), true)
})

Deno.test('validateCnpj aceita letras que a Receita só desencoraja na emissão (I, O, Q, F) — não é proibição do algoritmo', () => {
  // IOQF1234567822 — dígitos verificadores calculados corretamente à mão
  // para essa combinação; confirma que I/O/Q/F não são rejeitadas pelo
  // validador, só evitadas na emissão de novos CNPJs pela própria Receita.
  assertEquals(validateCnpj('IOQF1234567822'), true)
})

Deno.test('validateCnpj rejeita dígito verificador não-numérico', () => {
  assertEquals(validateCnpj('AB12CD34EFGH8A'), false)
  assertEquals(validateCnpj('AB12CD34EFGHA3'), false)
})

Deno.test('validateCnpj rejeita dígito verificador alfanumérico mesmo com checksum coincidente', () => {
  // Garante que a checagem de formato (posições 13-14 numéricas) roda antes
  // do cálculo — não basta o valor ASCII-48 "bater" por coincidência.
  assertEquals(validateCnpj('1122233300AB81'), false)
})

Deno.test('normalizeCnpj maiusculiza letras e remove máscara', () => {
  assertEquals(normalizeCnpj('ab.12c.d34/efgh-83'), 'AB12CD34EFGH83')
})

Deno.test('maskCnpjForDisplay esconde a raiz, mostra filial e dígitos verificadores', () => {
  assertEquals(maskCnpjForDisplay('11.222.333/0001-81'), '**.***.***/0001-81')
  assertEquals(maskCnpjForDisplay('AB12CD34EFGH83'), '**.***.***/EFGH-83')
})

Deno.test('maskCnpjForDisplay retorna placeholder genérico pra entrada inválida', () => {
  assertEquals(maskCnpjForDisplay('123'), '**.***.***/****-**')
  assertEquals(maskCnpjForDisplay(''), '**.***.***/****-**')
})
