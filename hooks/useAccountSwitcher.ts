// Plano CNPJ (velvet-puzzling-sedgewick)
// Estado e ações do seletor de conta — usado pelo Header em qualquer tela
// (Home pessoal ou de empresa) que precise oferecer a troca de contexto.

import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { useAuthStore } from '../store/auth.store'
import { useCompanyStore } from '../store/company.store'
import { useActiveContextStore, ActiveContext } from '../store/active-context.store'

export function useAccountSwitcher() {
  const token             = useAuthStore(s => s.token)
  const hasPersonalWallet = useAuthStore(s => s.user?.hasPersonalWallet !== false)
  const companies         = useCompanyStore(s => s.companies)
  const fetchCompanies    = useCompanyStore(s => s.fetchCompanies)
  const context           = useActiveContextStore(s => s.context)
  const setContext        = useActiveContextStore(s => s.setContext)

  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (token) fetchCompanies()
  }, [token])

  // Só mostra o seletor se houver mais de um contexto possível
  const canSwitch = (hasPersonalWallet ? 1 : 0) + companies.length > 1

  const select = (next: ActiveContext) => {
    setContext(next)
    setVisible(false)
    router.replace('/(app)/')
  }

  const openManage = () => {
    setVisible(false)
    router.push('/(app)/empresas')
  }

  return {
    visible,
    open:  () => setVisible(true),
    close: () => setVisible(false),
    canSwitch,
    hasPersonalWallet,
    companies,
    context,
    select,
    openManage,
  }
}
