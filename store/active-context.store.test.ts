jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
}))

import { useActiveContextStore } from './active-context.store'

describe('useActiveContextStore', () => {
  beforeEach(() => {
    useActiveContextStore.setState({ context: { type: 'personal' }, hydrated: false })
  })

  it('começa no contexto pessoal por padrão', () => {
    expect(useActiveContextStore.getState().context).toEqual({ type: 'personal' })
  })

  it('setContext troca o contexto ativo pra uma empresa', async () => {
    await useActiveContextStore.getState().setContext({
      type: 'company', companyId: 'company-1', companyName: 'Empresa X',
    })
    expect(useActiveContextStore.getState().context).toEqual({
      type: 'company', companyId: 'company-1', companyName: 'Empresa X',
    })
  })

  it('setContext volta pro contexto pessoal', async () => {
    await useActiveContextStore.getState().setContext({ type: 'company', companyId: 'c1', companyName: 'X' })
    await useActiveContextStore.getState().setContext({ type: 'personal' })
    expect(useActiveContextStore.getState().context).toEqual({ type: 'personal' })
  })
})
