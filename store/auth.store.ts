// Spec: /specs/01_frontend.md §3.1, §4
// Spec: /specs/05_security.md §7
// Token persistido em SecureStore — nunca AsyncStorage

import { create } from 'zustand'
import * as authService from '../services/auth.service'

function isJwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)
  } catch {
    return true
  }
}

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
  login:            (cpf: string, pinHash: string, securityAnswerHash: string, securityAnswerHashLegacy?: string) => Promise<void>
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

      // Token ausente ou expirado — limpa SecureStore e inicia sem sessão
      if (!token || isJwtExpired(token)) {
        await authService.logout()
        return
      }

      if (storedUser) {
        set({ token, isAuthenticated: true, user: storedUser as unknown as AuthUser })
        return
      }

      // User não estava no SecureStore (primeiro boot após atualização do app, etc.)
      // Busca dados básicos via /user-profile para recompor o AuthUser
      const profile = await authService.fetchUserProfile(token)
      if (profile) {
        const user: AuthUser = {
          id:         profile.id,
          name:       profile.name,
          handle:     profile.handle,
          email:      '',
          cpfMasked:  '',
          pixKey:     profile.pix_key_masked ?? '',
          pixKeyType: (profile.pix_key_type ?? 'cpf') as AuthUser['pixKeyType'],
        }
        await authService.saveUser(user as unknown as Record<string, unknown>)
        set({
          token,
          isAuthenticated:  true,
          user,
          kycStatus:        profile.kyc_status    as KycStatus,
          accountStatus:    profile.account_status as AccountStatus,
        })
      } else {
        // Rede indisponível (token válido localmente) — mantém autenticado sem user completo
        set({ token, isAuthenticated: true })
      }
    } catch {
      // SecureStore indisponível — inicia sem sessão
    } finally {
      set({ isLoadingSession: false })
    }
  },

  // ── Login real com PIN + resposta de segurança ─────────────────────────────
  login: async (cpf, pinHash, securityAnswerHash, securityAnswerHashLegacy?) => {
    const res = await authService.login(cpf, pinHash, securityAnswerHash, securityAnswerHashLegacy)

    const user: AuthUser = {
      id:           res.user.id,
      name:         res.user.name,
      handle:       res.user.handle,
      email:        res.user.email,
      cpfMasked:    '',
      pixKey:       '',
      pixKeyType:   'cpf',
    }

    await authService.saveTokens(res.token, res.refresh_token)
    await authService.saveUser(user as unknown as Record<string, unknown>)

    // Re-enroll: se o backend retornou textos das perguntas, salva localmente
    // para que próximos logins usem o fluxo de múltipla escolha
    if (res.security_questions && res.security_questions.length > 0) {
      const existing = await authService.getSecurityQuestions()
      if (existing.length === 0) {
        const ordered = [...res.security_questions].sort((a, b) => a.position - b.position)
        await authService.saveSecurityQuestions(ordered.map(q => q.question))
      }
    }

    set({
      user,
      token:           res.token,
      kycStatus:       res.user.kyc_status    as KycStatus,
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
