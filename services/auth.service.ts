// Spec: /specs/03_backend.md §4.1, §4.2
// Spec: /specs/01_frontend.md §4 (token em SecureStore)
// Camada HTTP entre app e Edge Functions de auth

import * as SecureStore from 'expo-secure-store'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// ── Chaves de SecureStore ─────────────────────────────────────────────────────

export const TOKEN_KEY          = 'auth_access_token'
export const REFRESH_TOKEN_KEY  = 'auth_refresh_token'
export const SEC_QUESTIONS_KEY  = 'auth_sec_questions'
export const SEC_ANSWERS_KEY    = 'auth_sec_answers'
export const USER_KEY           = 'auth_user'

// ── Erro tipado do BFF ────────────────────────────────────────────────────────

export class BffError extends Error {
  code:   string
  status: number
  /** Campos extra do corpo do erro (ex.: blocked_until em ACCOUNT_BLOCKED) */
  extra:  Record<string, unknown>
  constructor(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message)
    this.name   = 'BffError'
    this.code   = code
    this.status = status
    this.extra  = extra
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BFF}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        ANON_KEY,
      'Authorization': `Bearer ${token ?? ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  console.log(`[bff] ${path} → HTTP ${res.status}`)
  if (!res.ok) {
    console.log(`[bff] ${path} error body:`, JSON.stringify(data))
    const { code: _c, message: _m, ...extra } = data
    throw new BffError(
      String(data.code    ?? 'UNKNOWN'),
      String(data.message ?? 'Erro desconhecido'),
      res.status,
      extra,
    )
  }
  return data as T
}

// ── Register (spec §4.1) ──────────────────────────────────────────────────────

export interface RegisterInput {
  name:               string
  email:              string
  cpf:                string       // dígitos apenas
  birth_date:         string       // YYYY-MM-DD
  phone:              string       // dígitos apenas
  address: {
    street:       string
    number:       string
    complement?:  string
    neighborhood: string
    zip_code:     string
    city:         string
    state:        string
  }
  handle:             string
  pin_hash:           string       // SHA-256 do PIN de 6 dígitos
  security_questions: { question: string; answer_hash: string; answer_text?: string }[]
  pix_key?:           string
  pix_key_type?:      'cpf' | 'phone' | 'email' | 'random'
  terms_accepted:     boolean
  // false quando a pessoa só quer ser master/operador de empresa, sem
  // carteira pessoal própria (plano CNPJ velvet-puzzling-sedgewick).
  create_personal_wallet?: boolean
  // Presente quando o cadastro veio de um link de convite de operador.
  invite_token?: string
  // Presente quando o cadastro escolheu "Empresa" — cria a conta PJ junto,
  // com o usuário acima como master (plano CNPJ velvet-puzzling-sedgewick)
  company?: {
    cnpj:          string       // dígitos/letras, sem máscara
    handle:        string
    company_name:  string
    trading_name?: string
    company_type:  'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION'
    income_value:  number
    address: {
      street:       string
      number:       string
      complement?:  string
      neighborhood: string
      zip_code:     string
      city?:        string
      state?:       string
    }
    // Chave Pix de SAQUE da própria empresa — nunca cpf/phone/email (só faz
    // sentido CNPJ ou aleatória para pessoa jurídica). Opcional: ausente =
    // empresa criada sem chave configurada (master configura depois).
    pix_key_type?: 'cnpj' | 'random'
  }
}

export interface RegisterResponse {
  user_id:         string
  token:           string | null
  refresh_token:   string | null
  kyc_status:      string
  account_status:  string
  login_required?: boolean
  company_id?:             string
  company_account_status?: string
  company_kyc_status?:     string
  company_onboarding_url?: string | null
  company_error?:          { code: string; message: string }
  invite_error?:           { code: string; message: string }
}

export async function register(input: RegisterInput): Promise<RegisterResponse> {
  console.log('[auth.register] payload:', JSON.stringify({
    ...input,
    cpf:      `${input.cpf.slice(0, 3)}***`,
    pin_hash: '[MASKED]',
    security_questions: input.security_questions.map(q => ({
      question:    q.question,
      answer_hash: '[MASKED]',
    })),
  }))
  return post<RegisterResponse>('auth-register', input)
}

// ── Login (spec §4.2) ─────────────────────────────────────────────────────────

export interface LoginResponse {
  token:          string
  refresh_token:  string
  user: {
    id:             string
    name:           string
    handle:         string
    email:          string
    kyc_status:     string
    account_status: string
    has_personal_wallet: boolean
  }
}

export async function login(
  cpf:                         string,
  pin_hash:                    string,
  security_answer_hash:        string,
  security_answer_hash_legacy?: string,
): Promise<LoginResponse> {
  return post<LoginResponse>('auth-login', {
    cpf, pin_hash, security_answer_hash,
    ...(security_answer_hash_legacy ? { security_answer_hash_legacy } : {}),
  })
}

// ── Checagem de CPF já cadastrado (Melhoria 1 — cadastro de empresa) ─────────
// Primeiro passo do cadastro de empresa: descobre se o CPF do responsável já
// tem conta ativa, sem vazar mais nenhum dado — se tiver, o app pede login
// (PIN + pergunta de segurança) em vez de forçar um cadastro pessoal novo.

export async function checkCpfExists(cpf: string): Promise<boolean> {
  const res = await post<{ exists: boolean }>('auth-check-cpf', { cpf })
  return res.exists
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logout(): Promise<void> {
  // SEC_QUESTIONS_KEY e SEC_ANSWERS_KEY são dados de enrollment do dispositivo
  // necessários para o fluxo de múltipla-escolha no login — não apagar no logout
  await Promise.allSettled([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ])
}

export async function saveUser(user: Record<string, unknown>): Promise<void> {
  try   { await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)) }
  catch { /* não-crítico */ }
}

export async function getStoredUser(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
  } catch { return null }
}

export interface UserProfileResponse {
  id:             string
  name:           string
  handle:         string
  kyc_status:     string
  account_status: string
  member_since:   string
  email_masked:   string
  pix_key_masked: string
  pix_key_type:   string
  has_pix_key:    boolean
  has_personal_wallet: boolean
}

export async function fetchUserProfile(token: string): Promise<UserProfileResponse | null> {
  try {
    const res = await fetch(`${BFF}/user-profile`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    })
    if (!res.ok) return null
    return (await res.json()) as UserProfileResponse
  } catch { return null }
}

// ── Challenge de pergunta de segurança (requer PIN correto) ──────────────────

export interface SecurityChallenge {
  question:    string
  question_id: string
  options:     { hash: string; display: string }[]
}

export type SecurityChallengeResult =
  | { type: 'ok'; challenge: SecurityChallenge }
  | { type: 'pin_setup_required' }
  | { type: 'pin_invalid' }               // PIN errado — auth-login nunca chega a ser chamado nesse caso
  | { type: 'blocked'; blockedUntil: string } // conta temporariamente bloqueada (3 PIN ou 2 resposta errados)
  | { type: 'error' }                     // falha de rede/servidor — retry genérico faz sentido

export async function fetchSecurityChallenge(
  identifier: string,
  pinHash: string,
  excludeQuestionId?: string,
): Promise<SecurityChallengeResult> {
  try {
    const res = await fetch(`${BFF}/auth-question`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ identifier, pin_hash: pinHash, exclude_question_id: excludeQuestionId }),
    })
    if (!res.ok) return { type: 'error' }
    const data = await res.json() as {
      question:      string
      question_id?:  string
      options:       { hash: string; display: string }[]
      pin_setup_required?: boolean
      pin_invalid?:        boolean
      blocked?:            boolean
      blocked_until?:      string
    }
    if (data.pin_setup_required) return { type: 'pin_setup_required' }
    if (data.blocked)            return { type: 'blocked', blockedUntil: data.blocked_until ?? '' }
    if (data.pin_invalid)        return { type: 'pin_invalid' }
    if (!data.question && !data.options?.length) return { type: 'error' }
    return {
      type: 'ok',
      challenge: { question: data.question, question_id: data.question_id ?? '', options: data.options ?? [] },
    }
  } catch {
    return { type: 'error' }
  }
}

// ── Helpers de sessão ─────────────────────────────────────────────────────────

export async function saveTokens(token: string | null, refreshToken: string | null): Promise<void> {
  if (!token || !refreshToken) return // login_required: sessão não foi criada no cadastro
  await SecureStore.setItemAsync(TOKEN_KEY, token)
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken)
}

export async function getStoredToken(): Promise<string | null> {
  try   { return await SecureStore.getItemAsync(TOKEN_KEY) }
  catch { return null }
}

// Persiste textos das perguntas de segurança para exibir na tela de login
export async function saveSecurityQuestions(questions: string[]): Promise<void> {
  try   { await SecureStore.setItemAsync(SEC_QUESTIONS_KEY, JSON.stringify(questions)) }
  catch { /* não-crítico */ }
}

export async function getSecurityQuestions(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(SEC_QUESTIONS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch { return [] }
}

export async function saveSecurityAnswers(answers: string[]): Promise<void> {
  try   { await SecureStore.setItemAsync(SEC_ANSWERS_KEY, JSON.stringify(answers)) }
  catch { /* não-crítico */ }
}

export async function getSecurityAnswers(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(SEC_ANSWERS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch { return [] }
}
