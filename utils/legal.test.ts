import { legalDocVersion, buildConsentProof } from './legal'

jest.mock('./crypto', () => ({
  sha256Hex: jest.fn(async (s: string) => `hash(${s.length})`),
}))

describe('legalDocVersion', () => {
  it('extrai a data da linha "Última atualização" em formato ISO', () => {
    expect(legalDocVersion('Última atualização: 30/07/2026\n\n1. Quem somos')).toBe('2026-07-30')
  })

  it("retorna 'unknown' quando o texto não traz data", () => {
    expect(legalDocVersion('Declaro ter mais de 18 anos')).toBe('unknown')
  })
})

describe('buildConsentProof', () => {
  it('usa o próprio texto como fonte da versão por padrão', async () => {
    const body = 'Última atualização: 01/02/2026\n\ntexto'
    const p = await buildConsentProof('privacy_policy', body)
    expect(p).toEqual({ type: 'privacy_policy', version: '2026-02-01', text_hash: `hash(${body.length})` })
  })

  it('permite herdar a versão de outro documento (maioridade herda dos Termos)', async () => {
    const p = await buildConsentProof('majority', 'Declaro ter mais de 18 anos', 'Última atualização: 30/07/2026')
    expect(p.version).toBe('2026-07-30')
    expect(p.type).toBe('majority')
  })
})
