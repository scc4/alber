// Plano CNPJ (velvet-puzzling-sedgewick) — roteamento pós-login/cadastro
// Decide onde a pessoa cai depois de autenticar, considerando que master e
// operador podem não ter carteira pessoal:
//   - tem carteira pessoal → Home pessoal (comportamento de sempre)
//   - sem carteira pessoal + 1 empresa → cai direto nela
//   - sem carteira pessoal + 2+ empresas → tela de escolha (/empresas)
//   - sem carteira pessoal + 0 empresas (edge case) → /empresas (estado vazio)

import { useAuthStore } from '../store/auth.store'
import { useCompanyStore } from '../store/company.store'
import { useActiveContextStore } from '../store/active-context.store'

export async function resolveInitialRoute(): Promise<string> {
  const hasPersonalWallet = useAuthStore.getState().user?.hasPersonalWallet !== false

  if (hasPersonalWallet) {
    await useActiveContextStore.getState().setContext({ type: 'personal' })
    return '/(app)/'
  }

  await useCompanyStore.getState().fetchCompanies()
  const companies = useCompanyStore.getState().companies

  if (companies.length === 1) {
    const c = companies[0]
    await useActiveContextStore.getState().setContext({
      type: 'company',
      companyId: c.id,
      companyName: c.trading_name || c.company_name,
    })
    return '/(app)/'
  }

  return '/(app)/empresas'
}
