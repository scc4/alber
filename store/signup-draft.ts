// Estado transitório do onboarding — substituído por Zustand + persistência na integração real
// Nunca salvar dados sensíveis (PIN hash já é hash, mas pixKey e CPF são plaintext aqui — OK para mock)

export interface SignupDraft {
  // Etapa 0 — seletor de tipo de conta
  accountType: 'personal' | 'business'
  // Só relevante quando accountType === 'business' — false quando a pessoa
  // só quer ser master da empresa, sem carteira pessoal própria.
  wantsPersonalWallet: boolean
  // Presente quando o cadastro veio de um link de convite de operador —
  // nunca cria carteira pessoal nem empresa própria (plano CNPJ
  // velvet-puzzling-sedgewick).
  inviteToken?: string
  // Melhoria 1 — CPF do responsável já tem conta ativa: a pessoa fez login
  // (PIN + pergunta de segurança) em vez de preencher o cadastro pessoal de
  // novo. Pula direto para os dados da empresa; a sessão real já está no
  // auth.store (não duplicada aqui).
  existingAccountFlow?: boolean
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
  // Etapa 2.5 — dados da empresa, só quando accountType === 'business'
  companyName: string
  companyTradingName: string
  companyHandle: string
  cnpj: string
  companyType: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION'
  companyIncomeValue: string
  companyCep: string
  companyStreet: string
  companyNumber: string
  companyComplement: string
  companyNeighborhood: string
  companyCity: string
  companyState: string
  // Chave Pix de SAQUE da própria empresa — nunca cpf/phone/email, só CNPJ ou
  // aleatória (item 6 do plano de correções).
  companyPixType: 'cnpj' | 'random'
  // Etapa 3
  handle: string
  // Etapa 4
  pinHash: string
  // Etapa 5
  security: Array<{ question: string; answerHash: string; answerText?: string }>
  securityAnswers: string[]
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
