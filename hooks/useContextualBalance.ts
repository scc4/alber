// Plano CNPJ (velvet-puzzling-sedgewick)
// Fonte de saldo/atualização que respeita o contexto ativo (pessoal ou
// empresa) — usado pelas telas compartilhadas (carregar/transferir/receber/
// atividade) para não duplicar a ramificação em cada uma.

import { useActiveContextStore } from '../store/active-context.store'
import { useBalanceStore } from '../store/balance.store'
import { useCompanyStore } from '../store/company.store'

export interface ContextualBalance {
  balance: number
  stale: boolean
  status: 'idle' | 'loading' | 'success' | 'error'
  companyId: string | undefined
  fetchBalance: () => Promise<void>
}

export function useContextualBalance(): ContextualBalance {
  const context = useActiveContextStore(s => s.context)

  const personalBalance = useBalanceStore(s => s.balance)
  const personalStale   = useBalanceStore(s => s.stale)
  const personalStatus  = useBalanceStore(s => s.status)
  const fetchPersonal   = useBalanceStore(s => s.fetchBalance)

  const companyBalance  = useCompanyStore(s => s.activeBalance)
  const companyStatus   = useCompanyStore(s => s.balanceStatus)
  const fetchCompany    = useCompanyStore(s => s.fetchBalance)

  if (context.type === 'company') {
    return {
      balance:      companyBalance.available,
      stale:        companyBalance.stale,
      status:       companyStatus,
      companyId:    context.companyId,
      fetchBalance: () => fetchCompany(context.companyId),
    }
  }

  return {
    balance:      personalBalance,
    stale:        personalStale,
    status:       personalStatus,
    companyId:    undefined,
    fetchBalance: fetchPersonal,
  }
}
