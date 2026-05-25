// Spec: /specs/06_modules/home.md seção 3.2, /specs/04_api_asaas.md seção 4.8
// Saldo em Albers — preferência de ocultar persistida em SecureStore
// Mock ativo para Sprint 2 — substituir fetchBalance por Edge Function no Sprint 2/3

import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

const HIDDEN_PREF_KEY = 'balance_hidden_pref'

export type BalanceFetchStatus = 'idle' | 'loading' | 'success' | 'error'

interface BalanceState {
  balance:   number
  status:    BalanceFetchStatus
  hidden:    boolean

  // Actions
  fetchBalance:          () => Promise<void>
  toggleHidden:          () => Promise<void>
  loadHiddenPreference:  () => Promise<void>
}

export const useBalanceStore = create<BalanceState>((set, get) => ({
  balance: 0,
  status:  'idle',
  hidden:  false,

  loadHiddenPreference: async () => {
    try {
      const stored = await SecureStore.getItemAsync(HIDDEN_PREF_KEY)
      if (stored !== null) {
        set({ hidden: stored === 'true' })
      }
    } catch {
      // SecureStore indisponível — ignorar silenciosamente
    }
  },

  fetchBalance: async () => {
    set({ status: 'loading' })
    try {
      // Mock: simula latência de rede ~600ms
      // Produção: chamar Edge Function GET /balance com JWT do usuário
      await new Promise<void>(r => setTimeout(r, 600))
      set({ balance: 120, status: 'success' })
    } catch {
      set({ status: 'error' })
    }
  },

  toggleHidden: async () => {
    const next = !get().hidden
    set({ hidden: next })
    try {
      await SecureStore.setItemAsync(HIDDEN_PREF_KEY, String(next))
    } catch {
      // Falha silenciosa — preferência não persiste mas toggle funciona na sessão
    }
  },
}))
