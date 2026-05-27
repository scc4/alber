// Spec: /specs/03_backend.md §4.3
// Spec: /specs/04_api_asaas.md §4.8
// Camada HTTP entre app e Edge Functions financeiras

import { BffError } from './auth.service'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function headers(token: string): Record<string, string> {
  return {
    'Content-Type':  'application/json',
    'apikey':        ANON_KEY,
    'Authorization': `Bearer ${token}`,
  }
}

async function get<T>(path: string, token: string): Promise<T> {
  const res  = await fetch(`${BFF}/${path}`, { method: 'GET', headers: headers(token) })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new BffError(String(data.code ?? 'UNKNOWN'), String(data.message ?? 'Erro'), res.status)
  return data as T
}

async function post<T>(path: string, body: unknown, token: string): Promise<T> {
  const res  = await fetch(`${BFF}/${path}`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new BffError(String(data.code ?? 'UNKNOWN'), String(data.message ?? 'Erro'), res.status)
  return data as T
}

// ── Balance (spec §4.8) ───────────────────────────────────────────────────────

export interface BalanceResponse {
  available:      number
  blocked:        number
  total:          number
  currency:       string
  stale:          boolean
  kyc_status:     string
  account_status: string
}

export async function getBalance(token: string): Promise<BalanceResponse> {
  return get<BalanceResponse>('financial-balance', token)
}

// ── Carregar (spec §4.3) ──────────────────────────────────────────────────────

export interface CarregarResponse {
  payment_id:    string
  qr_code:       string
  qr_code_image: string
  expires_at:    string
}

export async function carregar(token: string, amountAlbers: number): Promise<CarregarResponse> {
  return post<CarregarResponse>('financial-carregar', { amount_albers: amountAlbers }, token)
}
