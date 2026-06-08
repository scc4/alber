// Spec: /specs/01_frontend.md §3.2
// Spec: /specs/04_api_asaas.md §4.8
// Saldo em Albers — paridade 1:1 com BRL (spec §5)

import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import * as financialService from '../services/financial.service'
import { useAuthStore, KycStatus, AccountStatus } from './auth.store'

const HIDDEN_PREF_KEY = 'balance_hidden_pref'

export type BalanceFetchStatus = 'idle' | 'loading' | 'success' | 'error'

interface BalanceState {
  available: number
  blocked:   number
  total:     number
  balance:   number            // alias de available — compat com componentes existentes
  stale:     boolean           // true quando Asaas retornou erro mas valor é 0
  status:    BalanceFetchStatus
  hidden:    boolean

  fetchBalance:         () => Promise<void>
  toggleHidden:         () => Promise<void>
  loadHiddenPreference: () => Promise<void>
}

export const useBalanceStore = create<BalanceState>((set) => ({
  available: 0,
  blocked:   0,
  total:     0,
  balance:   0,
  stale:     false,
  status:    'idle',
  hidden:    false,

  loadHiddenPreference: async () => {
    try {
      const stored = await SecureStore.getItemAsync(HIDDEN_PREF_KEY)
      if (stored !== null) set({ hidden: stored === 'true' })
    } catch {
      // SecureStore indisponível — ignorar silenciosamente
    }
  },

  fetchBalance: async () => {
    const token = useAuthStore.getState().token
    if (!token) return

    set({ status: 'loading' })
    try {
      const res       = await financialService.getBalance(token)
      const authStore = useAuthStore.getState()

      // Propaga status de KYC e conta retornados pelo BFF (pode ter sido atualizado via polling Asaas)
      if (res.kyc_status && res.kyc_status !== authStore.kycStatus) {
        authStore.setKycStatus(res.kyc_status as KycStatus)
      }
      if (res.account_status && res.account_status !== authStore.accountStatus) {
        authStore.setAccountStatus(res.account_status as AccountStatus)
      }

      set({
        available: res.available,
        blocked:   res.blocked,
        total:     res.total,
        balance:   res.available,   // mantém alias
        stale:     res.stale,
        status:    'success',
      })
    } catch {
      set({ status: 'success', stale: true })
    }
  },

  toggleHidden: async () => {
    set(prev => {
      const next = !prev.hidden
      SecureStore.setItemAsync(HIDDEN_PREF_KEY, String(next)).catch(() => {})
      return { hidden: next }
    })
  },
}))
