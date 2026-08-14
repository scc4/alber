import { validateCPF } from './cpf'

describe('validateCPF', () => {
  it('aceita CPFs válidos conhecidos (com e sem máscara)', () => {
    expect(validateCPF('52998224725')).toBe(true)
    expect(validateCPF('529.982.247-25')).toBe(true)
  })

  it('rejeita dígito verificador errado', () => {
    expect(validateCPF('52998224700')).toBe(false)
  })

  it('rejeita sequências triviais', () => {
    expect(validateCPF('11111111111')).toBe(false)
    expect(validateCPF('00000000000')).toBe(false)
  })

  it('rejeita tamanho incorreto', () => {
    expect(validateCPF('123456789')).toBe(false)
    expect(validateCPF('123456789012')).toBe(false)
    expect(validateCPF('')).toBe(false)
  })
})
