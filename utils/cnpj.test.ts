// Espelha supabase/functions/_shared/cnpj.test.ts (mesma implementação,
// cópia do lado cliente) — inclui os casos de CNPJ alfanumérico
// (Instrução Normativa RFB nº 2.229/2024, emissão a partir de 31/07/2026).

import { validateCNPJ, normalizeCNPJ } from './cnpj'

describe('validateCNPJ', () => {
  it('aceita CNPJs numéricos válidos conhecidos', () => {
    expect(validateCNPJ('11.222.333/0001-81')).toBe(true)
    expect(validateCNPJ('11444777000161')).toBe(true)
    expect(validateCNPJ('04252011000110')).toBe(true)
  })

  it('rejeita CNPJs com dígito verificador errado', () => {
    expect(validateCNPJ('11222333000199')).toBe(false)
    expect(validateCNPJ('11444777000162')).toBe(false)
  })

  it('rejeita tamanho incorreto', () => {
    expect(validateCNPJ('1122233300018')).toBe(false)
    expect(validateCNPJ('112223330001811')).toBe(false)
    expect(validateCNPJ('')).toBe(false)
  })

  it('rejeita sequências triviais', () => {
    expect(validateCNPJ('00000000000000')).toBe(false)
    expect(validateCNPJ('11111111111111')).toBe(false)
    expect(validateCNPJ('AAAAAAAAAAAAAA')).toBe(false)
  })

  it('aceita CNPJ alfanumérico (exemplo oficial da Receita)', () => {
    expect(validateCNPJ('AB12CD34/EFGH-83')).toBe(true)
    expect(validateCNPJ('AB12CD34EFGH83')).toBe(true)
  })

  it('aceita letras minúsculas normalizando para maiúscula', () => {
    expect(validateCNPJ('ab12cd34efgh83')).toBe(true)
  })

  it('aceita letras que a Receita só desencoraja na emissão (I, O, Q, F)', () => {
    // IOQF1234567822 — dígitos verificadores calculados corretamente à mão.
    expect(validateCNPJ('IOQF1234567822')).toBe(true)
  })

  it('rejeita dígito verificador não-numérico', () => {
    expect(validateCNPJ('AB12CD34EFGH8A')).toBe(false)
    expect(validateCNPJ('AB12CD34EFGHA3')).toBe(false)
  })

  it('rejeita dígito verificador alfanumérico mesmo com checksum coincidente', () => {
    expect(validateCNPJ('1122233300AB81')).toBe(false)
  })
})

describe('normalizeCNPJ', () => {
  it('remove máscara e maiusculiza letras', () => {
    expect(normalizeCNPJ('11.222.333/0001-81')).toBe('11222333000181')
    expect(normalizeCNPJ('ab.12c.d34/efgh-83')).toBe('AB12CD34EFGH83')
  })
})
