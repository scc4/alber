// Plano CNPJ (velvet-puzzling-sedgewick)
// Camada HTTP entre o app e as Edge Functions de empresa (contas PJ)

import { BffError } from './auth.service'
import { useAuthStore } from '../store/auth.store'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

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

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface CompanyPermissions {
  ver_saldo?:            boolean
  ver_extrato?:          boolean
  carregar?:             boolean
  descarregar?:          boolean
  transferir?:           boolean
  receber?:              boolean
  pagar?:                boolean
  gerenciar_operadores?: boolean
}

export interface CompanySummary {
  id:             string
  handle:         string
  company_name:   string
  trading_name:   string | null
  account_status: string
  kyc_status:     string
  onboarding_url: string | null
  cnpj_masked:    string | null
  role:           'master' | 'operator'
  permissions:    CompanyPermissions | null
}

export interface CompanyOperatorRow {
  operator_id: string
  user_id:     string | null
  name:        string | null
  handle:      string | null
  status:      'pending' | 'active' | 'banned' | 'invited'
  permissions: CompanyPermissions
  joined_at:   string | null
}

// ── Chamadas ───────────────────────────────────────────────────────────────────

export async function listCompanies(token: string): Promise<CompanySummary[]> {
  const res = await get<{ companies: CompanySummary[] }>('company-list', token)
  return res.companies
}

export async function listOperators(token: string, companyId: string): Promise<CompanyOperatorRow[]> {
  const res = await get<{ operators: CompanyOperatorRow[] }>(
    `company-operators-list?company_id=${encodeURIComponent(companyId)}`,
    token,
  )
  return res.operators
}

export async function inviteOperator(
  token: string,
  companyId: string,
  handle: string,
  permissions?: CompanyPermissions,
): Promise<{ company_id: string; invited_handle: string }> {
  return post('company-operator-invite', { company_id: companyId, handle, permissions }, token)
}

export async function joinCompany(token: string, companyId: string): Promise<{ status: string; company_id: string }> {
  return post('company-operator-join', { company_id: companyId }, token)
}

export async function createInviteLink(
  token: string,
  companyId: string,
  permissions?: CompanyPermissions,
): Promise<{ token: string; expires_at: string }> {
  return post('company-invite-link-create', { company_id: companyId, permissions }, token)
}

// Endpoint público — sem sessão, usado antes de a pessoa se cadastrar.
export async function previewInvite(inviteToken: string): Promise<{ valid: boolean; company_name: string | null }> {
  const res = await fetch(`${BFF}/company-invite-preview?token=${encodeURIComponent(inviteToken)}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  })
  if (!res.ok) return { valid: false, company_name: null }
  return res.json()
}

export async function setOperatorPermissions(
  token: string,
  companyId: string,
  operatorUserId: string,
  permissions: CompanyPermissions,
): Promise<{ permissions: CompanyPermissions }> {
  return post('company-operator-set-permissions', {
    company_id:       companyId,
    operator_user_id: operatorUserId,
    permissions,
  }, token)
}

export async function removeOperator(
  token: string,
  companyId: string,
  operatorUserId: string,
): Promise<{ operator_user_id: string; status: string }> {
  return post('company-operator-remove', { company_id: companyId, operator_user_id: operatorUserId }, token)
}

export async function setCompanyPixKey(
  token: string,
  companyId: string,
  type: 'cnpj' | 'random',
  pinHash: string,
  securityAnswerHash: string,
  cnpj?: string,
): Promise<{ pix_key_masked: string; pix_key_type: string }> {
  return post('company-set-pix-key', {
    company_id: companyId,
    type,
    cnpj,
    pin_hash: pinHash,
    security_answer_hash: securityAnswerHash,
  }, token)
}

// Empresas cadastradas antes de companies.cnpj_masked existir não têm essa
// coluna preenchida (só o hash é guardado) — a tela de Dados Cadastrais pede
// pro master/operador confirmar o CNPJ uma vez; se bater com o hash salvo,
// o backend calcula e persiste a máscara.
export async function confirmCompanyCnpj(
  token: string,
  companyId: string,
  cnpj: string,
): Promise<{ cnpj_masked: string }> {
  return post('company-confirm-cnpj', { company_id: companyId, cnpj }, token)
}

// Melhoria 1 — abre uma empresa numa conta pessoal já existente (usuário
// autenticado via CPF+PIN+pergunta de segurança), sem repetir o cadastro
// pessoal. Reaproveita a mesma validação/criação de auth-register do lado do
// servidor (createCompanyForOwner).
export interface CreateCompanyPayload {
  cnpj:          string
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
  pix_key_type?: 'cnpj' | 'random'
  // Aceite de Termos de Uso, Política de Privacidade e Transparência
  // Financeira (item 47 do QA) — obrigatório, exigido pelo backend.
  terms_accepted: boolean
}

export interface CreateCompanyResponse {
  company_id:             string
  company_account_status: string
  company_kyc_status:     string
  company_onboarding_url: string | null
}

export async function createCompany(token: string, company: CreateCompanyPayload): Promise<CreateCompanyResponse> {
  return post('company-create', { company }, token)
}

// Cancela o próprio cadastro de empresa antes da aprovação do KYC (plano
// velvet-puzzling-sedgewick) — só o master, e só enquanto kyc_status != 'approved'.
export async function abandonCompany(token: string, companyId: string): Promise<{ success: boolean }> {
  return post('company-abandon', { company_id: companyId }, token)
}
