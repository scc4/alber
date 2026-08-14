import { maskBRL, parseBRL, maskAlbers, parseAlbers } from './currency'

// Intl.NumberFormat('pt-BR', { style: 'currency', ... }) insere um espaço
// non-breaking (U+00A0) entre "R$" e o valor, dependendo da versão do ICU —
// normaliza pra espaço comum antes de comparar, pra não depender disso.
const normalizeSpaces = (s: string) => s.replace(/\s/g, ' ')

describe('maskBRL', () => {
  it('formata centavos digitados como moeda BRL', () => {
    expect(normalizeSpaces(maskBRL('500'))).toBe('R$ 5,00')
    expect(normalizeSpaces(maskBRL('150050'))).toBe('R$ 1.500,50')
  })

  it('retorna vazio para entrada vazia ou zero', () => {
    expect(maskBRL('')).toBe('')
    expect(maskBRL('0')).toBe('')
  })
})

describe('parseBRL', () => {
  it('extrai o valor numérico de uma string formatada', () => {
    expect(parseBRL('R$ 1.500,50')).toBe(1500.5)
    expect(parseBRL('R$ 5,00')).toBe(5)
  })

  it('retorna 0 para entrada inválida ou vazia', () => {
    expect(parseBRL('')).toBe(0)
    expect(parseBRL('abc')).toBe(0)
  })
})

describe('maskAlbers', () => {
  it('formata centavos digitados como número com 2 casas decimais', () => {
    expect(maskAlbers('500')).toBe('5,00')
    expect(maskAlbers('150050')).toBe('1.500,50')
  })

  it('retorna vazio para entrada vazia ou zero', () => {
    expect(maskAlbers('')).toBe('')
    expect(maskAlbers('0')).toBe('')
  })
})

describe('parseAlbers', () => {
  it('extrai o valor numérico de uma string formatada', () => {
    expect(parseAlbers('1.500,50')).toBe(1500.5)
  })

  it('retorna 0 para entrada inválida ou vazia', () => {
    expect(parseAlbers('')).toBe(0)
  })
})
