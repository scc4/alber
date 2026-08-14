import { getDraft, updateDraft, clearDraft } from './signup-draft'

describe('signup-draft', () => {
  beforeEach(() => {
    clearDraft()
  })

  it('começa vazio', () => {
    expect(getDraft()).toEqual({})
  })

  it('updateDraft mescla campos novos sem apagar os já existentes', () => {
    updateDraft({ name: 'Fulano', cpf: '52998224725' })
    updateDraft({ email: 'fulano@teste.com' })

    expect(getDraft()).toEqual({
      name: 'Fulano',
      cpf: '52998224725',
      email: 'fulano@teste.com',
    })
  })

  it('updateDraft sobrescreve um campo já existente', () => {
    updateDraft({ handle: 'antigo' })
    updateDraft({ handle: 'novo' })

    expect(getDraft().handle).toBe('novo')
  })

  it('clearDraft apaga tudo', () => {
    updateDraft({ name: 'Fulano', accountType: 'business' })
    clearDraft()

    expect(getDraft()).toEqual({})
  })
})
