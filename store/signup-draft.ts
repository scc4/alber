// Estado transitório do onboarding — substituído por Zustand + persistência na integração real
// Nunca salvar dados sensíveis (PIN hash já é hash, mas pixKey e CPF são plaintext aqui — OK para mock)

export interface SignupDraft {
  // Etapa 1
  name: string
  cpf: string
  birth: string
  email: string
  phone: string
  // Etapa 2
  cep: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city: string
  state: string
  // Etapa 3
  handle: string
  // Etapa 4
  pinHash: string
  // Etapa 5
  security: Array<{ question: string; answerHash: string }>
  // Etapa 6
  pixType: 'cpf' | 'phone' | 'email' | 'random'
  pixKey: string
}

let _draft: Partial<SignupDraft> = {}

export function getDraft(): Partial<SignupDraft> {
  return _draft
}

export function updateDraft(data: Partial<SignupDraft>): void {
  _draft = { ..._draft, ...data }
}

export function clearDraft(): void {
  _draft = {}
}
