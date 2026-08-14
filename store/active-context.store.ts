// Plano CNPJ (velvet-puzzling-sedgewick) — troca de conta global
// Contexto ativo do app: carteira pessoal ou uma empresa específica.
// Trocar de contexto é 100% client-side — nenhuma chamada de rede muda,
// cada Edge Function financeira já revalida a permissão a cada request
// (ver resolveWalletContext no backend). Persistido só por conveniência
// (reabrir o app já cai onde a pessoa deixou); a lista de empresas é
// sempre revalidada contra o servidor (company-list) no boot/login.

import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

const CONTEXT_KEY = 'active_context_pref'

export type ActiveContext =
  | { type: 'personal' }
  | { type: 'company'; companyId: string; companyName: string }

interface ActiveContextState {
  context: ActiveContext
  hydrated: boolean

  setContext: (context: ActiveContext) => Promise<void>
  loadContext: () => Promise<void>
}

export const useActiveContextStore = create<ActiveContextState>((set) => ({
  context: { type: 'personal' },
  hydrated: false,

  setContext: async (context) => {
    set({ context })
    try {
      await SecureStore.setItemAsync(CONTEXT_KEY, JSON.stringify(context))
    } catch {
      // não-crítico — na pior hipótese, próximo boot volta pro padrão
    }
  },

  loadContext: async () => {
    try {
      const raw = await SecureStore.getItemAsync(CONTEXT_KEY)
      if (raw) set({ context: JSON.parse(raw) as ActiveContext })
    } catch {
      // mantém o padrão 'personal'
    } finally {
      set({ hydrated: true })
    }
  },
}))
