// Estado transitório do fluxo "Esqueci meu PIN"
// Spec: /specs/05_security.md seção 5

import { create } from 'zustand'

interface RecoveryState {
  /** CPF ou @handle digitado na etapa 0 */
  identifier:   string
  /** Telefone mascarado retornado pelo backend (ex: "(**) *****-3421") */
  maskedPhone:  string | null
  /** E-mail mascarado retornado pelo backend (ex: "ma***@gm***.com") */
  maskedEmail:  string | null

  setIdentifier:  (id: string) => void
  setMaskedData:  (phone: string | null, email: string | null) => void
  reset:          () => void
}

export const useRecoveryStore = create<RecoveryState>(set => ({
  identifier:  '',
  maskedPhone: null,
  maskedEmail: null,

  setIdentifier: id  => set({ identifier: id }),
  setMaskedData: (phone, email) => set({ maskedPhone: phone, maskedEmail: email }),
  reset: () => set({ identifier: '', maskedPhone: null, maskedEmail: null }),
}))
