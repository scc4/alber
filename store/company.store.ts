// Plano CNPJ (velvet-puzzling-sedgewick)
// Estado das empresas (contas PJ) do usuário — lista, saldo da empresa ativa
// e operadores da empresa ativa (gestão, visível só ao master).

import { create } from 'zustand'
import * as companyService from '../services/company.service'
import * as financialService from '../services/financial.service'
import { useAuthStore } from './auth.store'
import type { CompanyOperatorRow, CompanyPermissions, CompanySummary } from '../services/company.service'

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error'

interface CompanyState {
  companies:       CompanySummary[]
  companiesStatus: FetchStatus

  activeBalance: { available: number; blocked: number; total: number; stale: boolean }
  balanceStatus: FetchStatus

  operators:       CompanyOperatorRow[]
  operatorsStatus: FetchStatus

  fetchCompanies:  () => Promise<void>
  fetchBalance:    (companyId: string) => Promise<void>
  fetchOperators:  (companyId: string) => Promise<void>
  setOperatorPermissions: (companyId: string, operatorUserId: string, permissions: CompanyPermissions) => Promise<void>
  abandonCompany:  (companyId: string) => Promise<void>
}

export const useCompanyStore = create<CompanyState>((set, get) => ({
  companies:       [],
  companiesStatus: 'idle',

  activeBalance: { available: 0, blocked: 0, total: 0, stale: false },
  balanceStatus: 'idle',

  operators:       [],
  operatorsStatus: 'idle',

  fetchCompanies: async () => {
    const token = useAuthStore.getState().token
    if (!token) return
    set({ companiesStatus: 'loading' })
    try {
      const companies = await companyService.listCompanies(token)
      set({ companies, companiesStatus: 'success' })
    } catch {
      set({ companiesStatus: 'error' })
    }
  },

  fetchBalance: async (companyId: string) => {
    const token = useAuthStore.getState().token
    if (!token) return
    set({ balanceStatus: 'loading' })
    try {
      const res = await financialService.getBalance(token, companyId)
      set({
        activeBalance: { available: res.available, blocked: res.blocked, total: res.total, stale: res.stale },
        balanceStatus: 'success',
      })
    } catch {
      set({ balanceStatus: 'error' })
    }
  },

  fetchOperators: async (companyId: string) => {
    const token = useAuthStore.getState().token
    if (!token) return
    set({ operatorsStatus: 'loading' })
    try {
      const operators = await companyService.listOperators(token, companyId)
      set({ operators, operatorsStatus: 'success' })
    } catch {
      set({ operatorsStatus: 'error' })
    }
  },

  setOperatorPermissions: async (companyId, operatorUserId, permissions) => {
    const token = useAuthStore.getState().token
    if (!token) return
    await companyService.setOperatorPermissions(token, companyId, operatorUserId, permissions)
    set({
      operators: get().operators.map(o =>
        o.user_id === operatorUserId ? { ...o, permissions: { ...o.permissions, ...permissions } } : o,
      ),
    })
  },

  abandonCompany: async (companyId: string) => {
    const token = useAuthStore.getState().token
    if (!token) return
    await companyService.abandonCompany(token, companyId)
    set({ companies: get().companies.filter(c => c.id !== companyId) })
  },
}))
