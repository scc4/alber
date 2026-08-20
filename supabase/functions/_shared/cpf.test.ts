// Roda com: deno test supabase/functions/_shared/cpf.test.ts

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { validateCpf, normalizeCpf, maskCpfForDisplay } from './cpf.ts'

Deno.test('validateCpf aceita CPFs válidos conhecidos', () => {
  assertEquals(validateCpf('111.444.777-35'), true)
  assertEquals(validateCpf('11144477735'), true)
})

Deno.test('validateCpf rejeita CPFs com dígito verificador errado', () => {
  assertEquals(validateCpf('11144477736'), false)
})

Deno.test('validateCpf rejeita sequências triviais', () => {
  assertEquals(validateCpf('00000000000'), false)
  assertEquals(validateCpf('11111111111'), false)
})

Deno.test('normalizeCpf remove tudo que não for dígito', () => {
  assertEquals(normalizeCpf('111.444.777-35'), '11144477735')
})

Deno.test('maskCpfForDisplay esconde os 2 primeiros blocos + 1º dígito do 3º bloco', () => {
  assertEquals(maskCpfForDisplay('111.444.777-35'), '***.***.*77-35')
  assertEquals(maskCpfForDisplay('11144477735'), '***.***.*77-35')
})

Deno.test('maskCpfForDisplay retorna placeholder genérico pra entrada inválida', () => {
  assertEquals(maskCpfForDisplay('123'), '***.***.***-**')
  assertEquals(maskCpfForDisplay(''), '***.***.***-**')
})
