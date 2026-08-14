// Lógica de criação de empresa (conta PJ) compartilhada entre:
//  - company-create      (usuário já logado abre uma empresa)
//  - auth-register       (cadastro de empresa já no onboarding, chamada
//                         diretamente — sem round-trip HTTP, pois o usuário
//                         ainda não tem uma sessão/JWT nesse ponto do fluxo)
//
// Espelha o essencial de auth-register (spec 04_api_asaas.md §4.1) para a
// subconta PJ, mas sem a máquina de `pending_registrations`: a recuperação de
// falha parcial aqui se apoia só em "se a Asaas já tem esse CNPJ, reusa a
// subconta existente" (mesmo catch de duplicata que auth-register usa) — mais
// simples e suficiente pro volume esperado de aberturas de conta PJ no MVP.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateCnpj, normalizeCnpj } from './cnpj.ts'
import { sha256hex, aesEncrypt } from './crypto.ts'
import { createAsaasAccount, getAsaasAccountByCpf, createPixAddressKey } from './asaas.ts'
import { logError } from './error-log.ts'

export interface CompanyAddressInput {
  street: string
  number: string
  complement?: string
  neighborhood: string
  zip_code: string
  city?: string
  state?: string
}

export interface CreateCompanyInput {
  cnpj: string
  handle: string
  company_name: string
  trading_name?: string
  company_type: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION'
  income_value: number
  address: CompanyAddressInput
}

// Mesmo formato do handle pessoal (ver app/(auth)/cadastro/handle.tsx):
// 3-20 caracteres, letras/números/underscore, sem _ nas pontas nem __ seguido.
const HANDLE_FORMAT = /^[a-z0-9_]{3,20}$/

export function isValidHandleFormat(h: string): boolean {
  return HANDLE_FORMAT.test(h) && !h.startsWith('_') && !h.endsWith('_') && !h.includes('__')
}

export type CreateCompanyOutcome =
  | {
      ok: true
      company_id: string
      account_status: string
      kyc_status: string
      onboarding_url: string | null
    }
  | {
      ok: false
      code: string
      message: string
      status: number
    }

const VALID_COMPANY_TYPES = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION']

export async function createCompanyForOwner(
  supabaseAdmin: SupabaseClient,
  ownerId: string,
  input: CreateCompanyInput,
): Promise<CreateCompanyOutcome> {
  if (
    !input?.cnpj || !input.company_name?.trim() || !input.company_type ||
    input.income_value == null || !input.address?.street || !input.address?.number ||
    !input.address?.neighborhood || !input.address?.zip_code
  ) {
    return { ok: false, code: 'MISSING_FIELDS', message: 'Campos obrigatórios da empresa ausentes', status: 400 }
  }

  if (!VALID_COMPANY_TYPES.includes(input.company_type)) {
    return { ok: false, code: 'INVALID_COMPANY_TYPE', message: 'company_type inválido', status: 400 }
  }

  const handleNorm = input.handle.toLowerCase().replace(/^@/, '')
  if (!isValidHandleFormat(handleNorm)) {
    return { ok: false, code: 'COMPANY_HANDLE_INVALID', message: '@handle da empresa inválido', status: 400 }
  }

  // Unicidade cruzada: não pode existir @handle igual entre users e companies
  // (a busca por handle em financial-transferir ficaria ambígua). Empresas com
  // deleted_at (rejeitada/abandonada — plano velvet-puzzling-sedgewick) não
  // contam mais: o handle já foi liberado (índice parcial da migration 044).
  const [{ data: handleUser }, { data: handleCompany }] = await Promise.all([
    supabaseAdmin.from('users').select('id').eq('handle', handleNorm).maybeSingle(),
    supabaseAdmin.from('companies').select('id').eq('handle', handleNorm).is('deleted_at', null).maybeSingle(),
  ])
  if (handleUser || handleCompany) {
    return { ok: false, code: 'COMPANY_HANDLE_TAKEN', message: '@handle da empresa já está em uso', status: 409 }
  }

  const cnpjClean = normalizeCnpj(input.cnpj)
  if (!validateCnpj(cnpjClean)) {
    return { ok: false, code: 'CNPJ_INVALID', message: 'CNPJ inválido', status: 422 }
  }

  const cnpjHash = await sha256hex(cnpjClean)

  const { data: owner } = await supabaseAdmin
    .from('users')
    .select('id, email, phone')
    .eq('id', ownerId)
    .maybeSingle()

  if (!owner) return { ok: false, code: 'USER_NOT_FOUND', message: 'Usuário não encontrado', status: 404 }

  // Empresas com deleted_at (rejeitada pelo Asaas ou abandonada pelo próprio
  // master antes da aprovação) não bloqueiam mais — o CNPJ já foi liberado
  // (índice parcial da migration 044, plano velvet-puzzling-sedgewick). Uma
  // linha ainda pendente bloqueia com um código diferente do já aprovado, pra
  // não sugerir "já existe uma conta" quando na verdade é só verificação em
  // andamento por outra pessoa.
  const { data: existingCnpj } = await supabaseAdmin
    .from('companies').select('id, kyc_status').eq('cnpj', cnpjHash).is('deleted_at', null).maybeSingle()
  if (existingCnpj) {
    return existingCnpj.kyc_status === 'pending'
      ? { ok: false, code: 'CNPJ_UNDER_REVIEW', message: 'Este CNPJ já está em processo de verificação por outra conta.', status: 409 }
      : { ok: false, code: 'CNPJ_DUPLICATE', message: 'CNPJ já cadastrado', status: 409 }
  }

  const encSecret     = Deno.env.get('ASAAS_API_KEY')!
  const pixKeySecret   = Deno.env.get('ENCRYPTION_KEY')!
  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
  const webhookUrl     = `${supabaseUrl}/functions/v1/webhooks-asaas-kyc`
  const pixWebhookUrl  = `${supabaseUrl}/functions/v1/webhooks-asaas-pix`
  const ownerPhone     = (owner.phone ?? '').replace(/\D/g, '')

  let asaasAccount: { id: string; apiKey: string; walletId: string }
  try {
    asaasAccount = await createAsaasAccount(
      {
        name:          input.company_name,
        email:         owner.email,
        cpfCnpj:       cnpjClean,
        companyType:   input.company_type,
        tradingName:   input.trading_name,
        phone:         ownerPhone,
        mobilePhone:   ownerPhone,
        address:       input.address.street,
        addressNumber: input.address.number,
        complement:    input.address.complement,
        province:      input.address.neighborhood,
        postalCode:    input.address.zip_code.replace(/\D/g, ''),
        incomeValue:   input.income_value,
        webhookUrl,
        pixWebhookUrl,
        webhookSecret: Deno.env.get('ASAAS_WEBHOOK_SECRET')!,
      },
      encSecret,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    let asaasErrorBody: Record<string, unknown> | null = null
    let description = ''
    try {
      const jsonStr  = msg.replace(/^ASAAS_ACCOUNT_CREATE_FAILED:\s*/, '')
      asaasErrorBody = JSON.parse(jsonStr) as Record<string, unknown>
      const errors   = asaasErrorBody.errors as Array<{ description?: string }> | undefined
      description    = errors?.[0]?.description ?? ''
    } catch { /* mensagem não estruturada */ }

    const lower  = description.toLowerCase()
    const isDup  = lower.includes('já está em uso') && (lower.includes('cpf') || lower.includes('cnpj'))

    if (!isDup) {
      await logError(supabaseAdmin, 'company-create', e, { cnpj: `${cnpjClean.slice(0, 8)}***` }, {
        asaas_response: asaasErrorBody,
      })
      return { ok: false, code: 'ASAAS_ERROR', message: description || 'Erro ao criar subconta financeira', status: 503 }
    }

    const existing = await getAsaasAccountByCpf(cnpjClean, encSecret)
    if (!existing) {
      return { ok: false, code: 'CNPJ_IN_USE', message: description, status: 409 }
    }
    asaasAccount = existing
  }

  const asaasApiKeyEnc = await aesEncrypt(asaasAccount.apiKey, encSecret)

  let depositKeyEnc: string | null = null
  if (asaasAccount.apiKey) {
    try {
      const { key } = await createPixAddressKey('EVP', asaasAccount.apiKey)
      depositKeyEnc = await aesEncrypt(key, pixKeySecret)
    } catch (e) {
      console.warn('[company-create] erro ao registrar chave Pix de recebimento (não-crítico):', e)
    }
  }

  let onboardingUrl: string | null = null
  if (asaasAccount.apiKey) {
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 15_000))
      const asaasBase = Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
        ? 'https://api.asaas.com/api/v3'
        : 'https://sandbox.asaas.com/api/v3'
      const docsRes = await fetch(`${asaasBase}/myAccount/documents`, {
        headers: { 'access_token': asaasAccount.apiKey },
      })
      if (docsRes.ok) {
        const docsData = await docsRes.json() as { onboardingUrl?: string }
        onboardingUrl = docsData.onboardingUrl ?? null
      }
    } catch (e) {
      console.warn('[company-create] erro ao buscar onboardingUrl (não-crítico):', e)
    }
  }

  const { data: company, error: insertErr } = await supabaseAdmin
    .from('companies')
    .insert({
      owner_id:          ownerId,
      asaas_account_id:  asaasAccount.id,
      asaas_wallet_id:   asaasAccount.walletId,
      asaas_api_key_enc: asaasApiKeyEnc,
      asaas_deposit_key: depositKeyEnc,
      cnpj:              cnpjHash,
      handle:            handleNorm,
      company_name:      input.company_name.trim(),
      trading_name:      input.trading_name?.trim() ?? null,
      company_type:      input.company_type,
      address:           input.address.street,
      address_number:    input.address.number,
      complement:        input.address.complement ?? null,
      province:          input.address.neighborhood,
      postal_code:       input.address.zip_code.replace(/\D/g, ''),
      city:              input.address.city ?? null,
      state:             input.address.state ?? null,
      income_value:      input.income_value,
      kyc_status:        'pending',
      account_status:    'evaluation',
      onboarding_url:    onboardingUrl,
    })
    .select('id')
    .single()

  if (insertErr || !company) {
    await logError(supabaseAdmin, 'company-create', insertErr ?? new Error('companies_insert_failed'), {
      owner_id: ownerId,
    }, {
      asaas_account_id: asaasAccount.id,
    })
    return { ok: false, code: 'DB_ERROR', message: 'Erro temporário ao criar empresa. Tente novamente.', status: 503 }
  }

  return {
    ok:             true,
    company_id:     company.id,
    account_status: 'evaluation',
    kyc_status:     'pending',
    onboarding_url: onboardingUrl,
  }
}
