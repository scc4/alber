// Spec: /specs/03_backend.md §4.3
// Spec: /specs/04_api_asaas.md §4.8
// Camada HTTP entre app e Edge Functions financeiras

import { BffError } from './auth.service'
import { useAuthStore } from '../store/auth.store'

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

function handleUnauthorized(): never {
  useAuthStore.getState().logout().catch(() => {})
  throw new BffError('UNAUTHORIZED', 'Sessão expirada. Faça login novamente.', 401)
}

async function get<T>(path: string, token: string): Promise<T> {
  const res  = await fetch(`${BFF}/${path}`, { method: 'GET', headers: headers(token) })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (res.status === 401) return handleUnauthorized()
  if (!res.ok) throw new BffError(String(data.code ?? 'UNKNOWN'), String(data.message ?? 'Erro'), res.status)
  return data as T
}

async function post<T>(path: string, body: unknown, token: string): Promise<T> {
  const res  = await fetch(`${BFF}/${path}`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (res.status === 401) return handleUnauthorized()
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
  payment_id:      string
  qr_code:         string
  qr_code_payload: string
  qr_code_image:   string
  amount_albers:   number
  amount_brl:      number
  expires_at:      string
}

export async function carregar(token: string, amountAlbers: number): Promise<CarregarResponse> {
  return post<CarregarResponse>('financial-carregar', { amount_albers: amountAlbers }, token)
}

// ── Descarregar (spec §4.4) ───────────────────────────────────────────────────

export interface DescarregarResponse {
  transaction_id: string
  amount_sent:    number
  fee:            number
  pix_key:        string
  status:         string
}

export async function descarregar(
  token: string,
  amountAlbers: number,
  pinHash: string,
  securityAnswerHash: string,
): Promise<DescarregarResponse> {
  return post<DescarregarResponse>('financial-descarregar', {
    amount_albers:        amountAlbers,
    pin_hash:             pinHash,
    security_answer_hash: securityAnswerHash,
  }, token)
}

// ── Criar chave Pix EVP ───────────────────────────────────────────────────────

export interface CreatePixKeyResponse {
  pix_key_masked: string
  pix_key_type:   string
}

export async function createPixKey(token: string): Promise<CreatePixKeyResponse> {
  return post<CreatePixKeyResponse>('financial-create-pix-key', {}, token)
}

// ── Receber (spec §4.5) ───────────────────────────────────────────────────────

export interface ReceberResponse {
  transaction_id:  string
  amount_received: number
  fee:             number
  payer_name:      string
  status:          string
}

export async function receber(
  token: string,
  amountAlbers: number,
  payerIdentifier: string,
  payerPinHash: string,
  payerSecurityAnswerHash: string,
): Promise<ReceberResponse> {
  return post<ReceberResponse>('financial-receber', {
    amount_albers:               amountAlbers,
    payer_identifier:            payerIdentifier,
    payer_pin_hash:              payerPinHash,
    payer_security_answer_hash:  payerSecurityAnswerHash,
  }, token)
}

// ── Transferir (spec §4.6) ────────────────────────────────────────────────────

export interface TransferirResponse {
  transaction_id:      string
  amount:              number
  destinatario_handle: string
  novo_saldo:          number
}

export async function transferir(
  token: string,
  destinatarioIdentifier: string,
  amountAlbers: number,
  pinHash: string,
  securityAnswerHash: string,
): Promise<TransferirResponse> {
  return post<TransferirResponse>('financial-transferir', {
    destinatario_identifier: destinatarioIdentifier,
    amount_albers:           amountAlbers,
    pin_hash:                pinHash,
    security_answer_hash:    securityAnswerHash,
  }, token)
}
