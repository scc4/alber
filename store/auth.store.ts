// Spec: /specs/06_modules/home.md, /specs/05_security.md
// Estado de autenticação global — usuário, KYC, status da conta
// Mock ativo para Sprint 2 — conectar ao Supabase no Sprint 6 (perfil/KYC)

import { create } from 'zustand'

export type KycStatus     = 'pending' | 'submitted' | 'approved' | 'rejected'
export type AccountStatus = 'active' | 'evaluation' | 'blocked'

export interface AuthUser {
  id:          string
  name:        string
  handle:      string
  cpfMasked:   string  // ex: '***.456-78' — nunca CPF completo no app
  pixKey:      string  // ex: '(11) ****-1234' — mascarado
  pixKeyType:  'cpf' | 'phone' | 'email' | 'random'
}

interface AuthState {
  user:            AuthUser | null
  kycStatus:       KycStatus
  accountStatus:   AccountStatus
  isAuthenticated: boolean

  // Actions
  setUser:       (user: AuthUser) => void
  setKycStatus:  (status: KycStatus) => void
  setAccountStatus: (status: AccountStatus) => void
  logout:        () => void
}

// Mock: usuário aprovado, conta ativa — troca kycStatus/accountStatus para testar banners
const MOCK_USER: AuthUser = {
  id:         'usr_mock_001',
  name:       'Mayte Alber',
  handle:     '@mayte',
  cpfMasked:  '***.456-78',
  pixKey:     '(11) ****-1234',
  pixKeyType: 'phone',
}

export const useAuthStore = create<AuthState>((set) => ({
  user:            MOCK_USER,
  kycStatus:       'approved',
  accountStatus:   'active',
  isAuthenticated: true,

  setUser: (user) =>
    set({ user, isAuthenticated: true }),

  setKycStatus: (kycStatus) =>
    set({ kycStatus }),

  setAccountStatus: (accountStatus) =>
    set({ accountStatus }),

  logout: () =>
    set({ user: null, isAuthenticated: false }),
}))
