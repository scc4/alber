// Plano CNPJ (velvet-puzzling-sedgewick): matriz de permissões por operador.
//
// Uma empresa tem um cadastro MASTER (companies.owner_id) com acesso total e
// implícito — nunca passa por esta matriz. Operadores (company_operators) só
// podem usar o que está explicitamente `true` em `permissions`. Chave ausente
// ou `false` = negado (fail-closed).
//
// Lista central de chaves válidas — toda tela/funcionalidade nova de empresa
// que precisar de um controle de acesso próprio deve adicionar sua chave aqui
// (e no espelho do app, ver store/company.store.ts).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const COMPANY_PERMISSION_KEYS = [
  'ver_saldo',
  'ver_extrato',
  'carregar',
  'descarregar',
  'transferir',
  'receber',
  'pagar',
  'gerenciar_operadores',
] as const

export type CompanyPermissionKey = typeof COMPANY_PERMISSION_KEYS[number]

export function isValidCompanyPermissionKey(key: string): key is CompanyPermissionKey {
  return (COMPANY_PERMISSION_KEYS as readonly string[]).includes(key)
}

export interface CompanyRow {
  id: string
  owner_id: string
  asaas_account_id: string
  asaas_wallet_id: string | null
  asaas_api_key_enc: string | null
  asaas_deposit_key: string | null
  pix_key: string | null
  pix_key_type: string | null
  account_status: string
  kyc_status: string
  created_at: string
}

export interface CompanyAccessResult {
  ok: boolean
  isMaster?: boolean
  company?: CompanyRow
}

/**
 * Verifica se `userId` pode executar `permission` na empresa `companyId`.
 * Master (companies.owner_id) sempre autorizado. Operador precisa de linha
 * ativa em company_operators com permissions[permission] === true.
 */
export async function requireCompanyPermission(
  supabaseAdmin: SupabaseClient,
  userId: string,
  companyId: string,
  permission: CompanyPermissionKey,
): Promise<CompanyAccessResult> {
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, asaas_account_id, asaas_wallet_id, asaas_api_key_enc, asaas_deposit_key, pix_key, pix_key_type, account_status, kyc_status, created_at')
    .eq('id', companyId)
    .maybeSingle()

  if (!company) return { ok: false }

  if (company.owner_id === userId) {
    return { ok: true, isMaster: true, company: company as CompanyRow }
  }

  const { data: operator } = await supabaseAdmin
    .from('company_operators')
    .select('permissions')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (!operator || operator.permissions?.[permission] !== true) {
    return { ok: false }
  }

  return { ok: true, isMaster: false, company: company as CompanyRow }
}

// ── Resolução unificada de carteira (pessoal ou empresa) ─────────────────────
// Usado pelas Edge Functions financeiras: quando `companyId` é informado, a
// operação passa a atuar sobre a subconta da empresa (checando a permissão
// correspondente); caso contrário, mantém o comportamento pessoal de sempre.
// `user_id` gravado nas transações continua sendo sempre quem executou a ação
// (o usuário autenticado) — `companyId` só identifica de qual carteira.

export interface PersonalWalletRow {
  asaas_api_key_enc: string | null
  asaas_wallet_id?:  string | null
  asaas_deposit_key?: string | null
  pix_key?:          string | null
  pix_key_type?:     string | null
  kyc_status:        string
  account_status:    string
  created_at:        string
}

export interface WalletContext {
  ownerType:        'personal' | 'company'
  companyId:        string | null
  asaasApiKeyEnc:   string | null
  asaasWalletId:    string | null
  asaasDepositKey:  string | null
  pixKey:           string | null
  pixKeyType:       string | null
  kycStatus:        string
  accountStatus:    string
  createdAt:        string
}

export type WalletResolution =
  | { ok: true; wallet: WalletContext }
  | { ok: false; code: string; message: string; status: number }

export async function resolveWalletContext(
  supabaseAdmin: SupabaseClient,
  actorUserId: string,
  companyId: string | null | undefined,
  permission: CompanyPermissionKey,
  personalRow: PersonalWalletRow,
): Promise<WalletResolution> {
  if (!companyId) {
    return {
      ok: true,
      wallet: {
        ownerType:       'personal',
        companyId:       null,
        asaasApiKeyEnc:  personalRow.asaas_api_key_enc,
        asaasWalletId:   personalRow.asaas_wallet_id ?? null,
        asaasDepositKey: personalRow.asaas_deposit_key ?? null,
        pixKey:          personalRow.pix_key ?? null,
        pixKeyType:      personalRow.pix_key_type ?? null,
        kycStatus:       personalRow.kyc_status,
        accountStatus:   personalRow.account_status,
        createdAt:       personalRow.created_at,
      },
    }
  }

  const access = await requireCompanyPermission(supabaseAdmin, actorUserId, companyId, permission)
  if (!access.ok || !access.company) {
    return { ok: false, code: 'FORBIDDEN', message: 'Sem permissão para esta operação na empresa', status: 403 }
  }

  const c = access.company
  return {
    ok: true,
    wallet: {
      ownerType:       'company',
      companyId:       c.id,
      asaasApiKeyEnc:  c.asaas_api_key_enc,
      asaasWalletId:   c.asaas_wallet_id,
      asaasDepositKey: c.asaas_deposit_key,
      pixKey:          c.pix_key,
      pixKeyType:      c.pix_key_type,
      kycStatus:       c.kyc_status,
      accountStatus:   c.account_status,
      createdAt:       c.created_at,
    },
  }
}
