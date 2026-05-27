// Spec: /specs/03_backend.md §4.1, §4.2
// Spec: /specs/01_frontend.md §4 (token em SecureStore)
// Camada HTTP entre app e Edge Functions de auth

import * as SecureStore from 'expo-secure-store'

const BFF      = (process.env.EXPO_PUBLIC_BFF_URL ?? '').replace(/\/$/, '')
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// ── Chaves de SecureStore ─────────────────────────────────────────────────────

export const TOKEN_KEY          = 'auth_access_token'
export const REFRESH_TOKEN_KEY  = 'auth_refresh_token'
export const SEC_QUESTIONS_KEY  = 'auth_sec_questions'

// ── Erro tipado do BFF ────────────────────────────────────────────────────────

export class BffError extends Error {
  code:   string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name   = 'BffError'
    this.code   = code
    this.status = status
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
  if (!res.ok) {
    throw new BffError(
      String(data.code    ?? 'UNKNOWN'),
      String(data.message ?? 'Erro desconhecido'),
      res.status,
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
  security_questions: { question: string; answer_hash: string }[]
  pix_key:            string
  pix_key_type:       'cpf' | 'phone' | 'email' | 'random'
  terms_accepted:     boolean
}

export interface RegisterResponse {
  user_id:        string
  token:          string
  refresh_token:  string
  kyc_status:     string
  account_status: string
}

export async function register(input: RegisterInput): Promise<RegisterResponse> {
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
  }
}

export async function login(
  cpf:                  string,
  pin_hash:             string,
  security_answer_hash: string,
): Promise<LoginResponse> {
  return post<LoginResponse>('auth-login', { cpf, pin_hash, security_answer_hash })
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logout(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(SEC_QUESTIONS_KEY),
  ])
}

// ── Helpers de sessão ─────────────────────────────────────────────────────────

export async function saveTokens(token: string, refreshToken: string): Promise<void> {
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
