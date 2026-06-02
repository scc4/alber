// Spec: /specs/01_frontend.md §3.1, §4
// Spec: /specs/05_security.md §7
// Token persistido em SecureStore — nunca AsyncStorage

import { create } from 'zustand'
import * as authService from '../services/auth.service'

export type KycStatus     = 'pending' | 'submitted' | 'approved' | 'rejected'
export type AccountStatus = 'active' | 'evaluation' | 'blocked'

export interface AuthUser {
  id:           string
  name:         string
  handle:       string
  email:        string
  cpfMasked:    string  // '***.xxx-xx' — preenchido via endpoint de perfil (futuro)
  pixKey:       string  // mascarado — preenchido via endpoint de perfil (futuro)
  pixKeyType:   'cpf' | 'phone' | 'email' | 'random'
}

interface AuthState {
  user:             AuthUser | null
  token:            string | null
  kycStatus:        KycStatus
  accountStatus:    AccountStatus
  isAuthenticated:  boolean
  isLoadingSession: boolean

  // Actions
  login:            (cpf: string, pinHash: string, securityAnswerHash: string) => Promise<void>
  setSession:       (token: string, refreshToken: string, user: AuthUser, kycStatus: KycStatus, accountStatus: AccountStatus) => Promise<void>
  loadSession:      () => Promise<void>
  logout:           () => Promise<void>
  setUser:          (user: AuthUser) => void
  setKycStatus:     (status: KycStatus) => void
  setAccountStatus: (status: AccountStatus) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user:             null,
  token:            null,
  kycStatus:        'pending',
  accountStatus:    'evaluation',
  isAuthenticated:  false,
  isLoadingSession: true,

  // ── Restaura sessão do SecureStore ao iniciar o app ────────────────────────
  loadSession: async () => {
    try {
      const [token, storedUser] = await Promise.all([
        authService.getStoredToken(),
        authService.getStoredUser(),
      ])
      if (token) {
        set({
          token,
          isAuthenticated: true,
          ...(storedUser ? { user: storedUser as unknown as AuthUser } : {}),
        })
      }
    } catch {
      // SecureStore indisponível — inicia sem sessão
    } finally {
      set({ isLoadingSession: false })
    }
  },

  // ── Login real com PIN + resposta de segurança ─────────────────────────────
  login: async (cpf, pinHash, securityAnswerHash) => {
    const res = await authService.login(cpf, pinHash, securityAnswerHash)

    const user: AuthUser = {
      id:           res.user.id,
      name:         res.user.name,
      handle:       res.user.handle,
      email:        res.user.email,
      cpfMasked:    '',   // TODO: carregar via endpoint de perfil
      pixKey:       '',
      pixKeyType:   'cpf',
    }

    await authService.saveTokens(res.token, res.refresh_token)
    await authService.saveUser(user as unknown as Record<string, unknown>)

    set({
      user,
      token:           res.token,
      kycStatus:       res.user.kyc_status  as KycStatus,
      accountStatus:   res.user.account_status as AccountStatus,
      isAuthenticated: true,
    })
  },

  // ── Sessão criada após registro ────────────────────────────────────────────
  setSession: async (token, refreshToken, user, kycStatus, accountStatus) => {
    await authService.saveTokens(token, refreshToken)
    await authService.saveUser(user as unknown as Record<string, unknown>)
    set({ user, token, kycStatus, accountStatus, isAuthenticated: true })
  },

  // ── Logout — limpa SecureStore + estado ───────────────────────────────────
  logout: async () => {
    await authService.logout()
    set({
      user:            null,
      token:           null,
      kycStatus:       'pending',
      accountStatus:   'evaluation',
      isAuthenticated: false,
    })
  },

  setUser:          (user)          => set({ user }),
  setKycStatus:     (kycStatus)     => set({ kycStatus }),
  setAccountStatus: (accountStatus) => set({ accountStatus }),
}))
