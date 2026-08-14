import {
  formatCurrency,
  formatAlbers,
  formatDate,
  formatDateTime,
  formatDateGroup,
  maskDate,
  maskTime,
  maskCNPJ,
} from './format'

// Intl.NumberFormat('pt-BR', { style: 'currency', ... }) insere um espaço
// non-breaking (U+00A0) entre "R$" e o valor, dependendo da versão do ICU —
// normaliza pra espaço comum antes de comparar, pra não depender disso.
const normalizeSpaces = (s: string) => s.replace(/\s/g, ' ')

describe('formatCurrency', () => {
  it('formata número como moeda BRL', () => {
    expect(normalizeSpaces(formatCurrency(1234.5))).toBe('R$ 1.234,50')
  })
})

describe('formatAlbers', () => {
  it('formata número com 2 casas decimais, sem símbolo de moeda', () => {
    expect(formatAlbers(1234.5)).toBe('1.234,50')
  })
})

describe('formatDate', () => {
  it('formata data ISO como DD/MM/AAAA', () => {
    expect(formatDate('2026-03-05T14:30:00Z')).toBe('05/03/2026')
  })

  it('retorna vazio para string vazia', () => {
    expect(formatDate('')).toBe('')
  })

  it('retorna a string original quando a data é inválida', () => {
    expect(formatDate('não-é-data')).toBe('não-é-data')
  })
})

describe('formatDateTime', () => {
  it('formata data e hora no padrão DD/MM/AAAA HH:MM', () => {
    const result = formatDateTime('2026-03-05T14:30:00Z')
    expect(result).toMatch(/^05\/03\/2026 \d{2}:\d{2}$/)
  })

  it('retorna vazio para string vazia', () => {
    expect(formatDateTime('')).toBe('')
  })
})

describe('formatDateGroup', () => {
  it('retorna "Hoje" para a data de hoje', () => {
    expect(formatDateGroup(new Date().toISOString())).toBe('Hoje')
  })

  it('retorna "Ontem" para a data de ontem', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(formatDateGroup(yesterday.toISOString())).toBe('Ontem')
  })

  it('retorna data por extenso para datas mais antigas', () => {
    expect(formatDateGroup('2020-01-15T12:00:00Z')).toBe('15 de janeiro de 2020')
  })

  it('retorna vazio para string vazia', () => {
    expect(formatDateGroup('')).toBe('')
  })
})

describe('maskDate', () => {
  it('aplica a máscara DD/MM/AAAA progressivamente', () => {
    expect(maskDate('05')).toBe('05')
    expect(maskDate('0503')).toBe('05/03')
    expect(maskDate('05032026')).toBe('05/03/2026')
  })

  it('ignora caracteres não numéricos e limita a 8 dígitos', () => {
    expect(maskDate('05/03/2026extra')).toBe('05/03/2026')
  })
})

describe('maskTime', () => {
  it('aplica a máscara HH:MM progressivamente', () => {
    expect(maskTime('14')).toBe('14')
    expect(maskTime('1430')).toBe('14:30')
  })
})

describe('maskCNPJ', () => {
  it('aplica a máscara XX.XXX.XXX/XXXX-XX progressivamente', () => {
    expect(maskCNPJ('11')).toBe('11')
    expect(maskCNPJ('11222')).toBe('11.222')
    expect(maskCNPJ('11222333')).toBe('11.222.333')
    expect(maskCNPJ('112223330001')).toBe('11.222.333/0001')
    expect(maskCNPJ('11222333000181')).toBe('11.222.333/0001-81')
  })

  it('aceita letras e maiusculiza (CNPJ alfanumérico)', () => {
    expect(maskCNPJ('ab12cd34efgh83')).toBe('AB.12C.D34/EFGH-83')
  })

  it('remove caracteres inválidos e limita a 14 posições', () => {
    expect(maskCNPJ('11.222.333/0001-81extra')).toBe('11.222.333/0001-81')
  })
})
