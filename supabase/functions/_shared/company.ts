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

import { isReservedByOther } from './handle-reservation.ts'
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateCnpj, normalizeCnpj, maskCnpjForDisplay } from './cnpj.ts'
import { sha256hex, aesEncrypt } from './crypto.ts'
import { createAsaasAccount, getAsaasAccountByCpf, createPixAddressKey } from './asaas.ts'
import { logError } from './error-log.ts'
import { evaluateOwnerCpf, fetchCnpjRegistry, reviewFor, verifyOwnerCpfHash, type CnpjRegistry, type OwnerLinkCheck } from './owner-link.ts'

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
  // E-mail de contato da empresa (o Asaas escreve para ele: pedidos de documento, avisos). Opcional: sem ele vai um endereço sintético
  // só da empresa. Se o Asaas recusar por já estar em uso em outra subconta, tenta de novo com `+cnpj` antes do @ (continua chegando ao dono).
  email?: string
  // CPF do responsável, digitado por ele para confirmar o vínculo com o CNPJ. É conferido pelo hash da conta (tem de ser o CPF de quem
  // está logado) e comparado com o quadro societário. Sem ele a empresa nasce "não conferida" e fica em revisão da equipe.
  owner_cpf?: string
  // Regime tributário da empresa, como o Asaas aceita (taxRegime). Opcional.
  tax_regime?: 'MEI' | 'NATIONAL_SIMPLE' | 'NORMAL_REGIME' | 'UNKNOWN'
  // Chave Pix de SAQUE da própria empresa (nunca cpf/phone/email — só faz
  // sentido CNPJ ou aleatória para uma pessoa jurídica). Opcional: se ausente,
  // a empresa é criada sem chave configurada, igual ao comportamento de
  // sempre (o master configura depois via company-set-pix-key).
  pix_key_type?: 'cnpj' | 'random'
  // Aceite de Termos/Privacidade/Transparência Financeira (item 47 do QA).
  // Opcional aqui pois no fluxo bundlado (auth-register) o aceite já é
  // validado no nível do request inteiro (terms_accepted da conta pessoal) —
  // quem exige e valida este campo é company-create/index.ts, único caminho
  // que cria uma empresa sem passar por nenhum outro aceite antes.
  terms_accepted?: boolean
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
      owner_link_check: OwnerLinkCheck | 'unchecked'
      owner_link_review: 'not_needed' | 'pending'
    }
  | {
      ok: false
      code: string
      message: string
      status: number
    }

const VALID_COMPANY_TYPES = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION']
const VALID_TAX_REGIMES = ['MEI', 'NATIONAL_SIMPLE', 'NORMAL_REGIME', 'UNKNOWN']
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** `dono@gmail.com` -> `dono+65886568000105@gmail.com`: continua chegando ao dono e é único por empresa. */
export function plusAliasEmail(email: string, cnpj: string): string {
  const [local, domain] = email.split('@') as [string, string]
  return `${local.split('+')[0]}+${cnpj.toLowerCase()}@${domain}`
}

export interface CreateCompanyDeps {
  /** Consulta ao quadro societário do CNPJ (injetável nos testes). */
  registry?: (cnpj: string) => Promise<CnpjRegistry | null>
}

export async function createCompanyForOwner(
  supabaseAdmin: SupabaseClient,
  ownerId: string,
  input: CreateCompanyInput,
  deps: CreateCompanyDeps = {},
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

  if (input.pix_key_type != null && input.pix_key_type !== 'cnpj' && input.pix_key_type !== 'random') {
    return { ok: false, code: 'INVALID_PIX_KEY_TYPE', message: 'Chave Pix da empresa deve ser cnpj ou random', status: 400 }
  }

  if (input.tax_regime != null && !VALID_TAX_REGIMES.includes(input.tax_regime)) {
    return { ok: false, code: 'INVALID_TAX_REGIME', message: 'tax_regime inválido', status: 400 }
  }
  const contactEmail = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (input.email != null && (!contactEmail || contactEmail.length > 254 || !EMAIL_FORMAT.test(contactEmail))) {
    return { ok: false, code: 'EMAIL_INVALID', message: 'E-mail da empresa inválido', status: 400 }
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
  if (handleUser || handleCompany || (await isReservedByOther(supabaseAdmin, handleNorm))) {
    return { ok: false, code: 'COMPANY_HANDLE_TAKEN', message: '@handle da empresa já está em uso', status: 409 }
  }

  const cnpjClean = normalizeCnpj(input.cnpj)
  if (!validateCnpj(cnpjClean)) {
    return { ok: false, code: 'CNPJ_INVALID', message: 'CNPJ inválido', status: 422 }
  }

  const cnpjHash   = await sha256hex(cnpjClean)
  const cnpjMasked = maskCnpjForDisplay(cnpjClean)

  const { data: owner } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, cpf, account_status, kyc_status')
    .eq('id', ownerId)
    .maybeSingle()

  if (!owner) return { ok: false, code: 'USER_NOT_FOUND', message: 'Usuário não encontrado', status: 404 }

  // Estado da conta do dono (plano de conferência CNPJ x administrador, fase 3): conta bloqueada ou com a verificação pessoal recusada não
  // abre empresa. Quem acaba de se cadastrar (auth-register) está "pending"/"evaluation", então não é afetado.
  const ownerState = owner as { account_status?: string | null; kyc_status?: string | null }
  if (ownerState.account_status === 'blocked') {
    return { ok: false, code: 'OWNER_ACCOUNT_BLOCKED', message: 'Sua conta está bloqueada e não pode abrir uma empresa. Fale com o suporte.', status: 403 }
  }
  if (ownerState.kyc_status === 'rejected') {
    return { ok: false, code: 'PERSONAL_KYC_REJECTED', message: 'A verificação da sua conta pessoal foi recusada e não é possível abrir uma empresa. Fale com o suporte.', status: 403 }
  }

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

  // ── Vínculo do responsável com o CNPJ (antes de criar qualquer coisa no Asaas) ───────────────────────────────────────────────
  // Com o CPF digitado: tem de ser o da conta (hash) e é comparado com o quadro societário. Sem ele: "não conferida" -> revisão.
  let linkCheck: OwnerLinkCheck | 'unchecked' = 'unchecked'
  let linkQualification: string | null = null
  if (input.owner_cpf != null) {
    const proof = await verifyOwnerCpfHash(input.owner_cpf, (owner as { cpf?: string | null }).cpf)
    if (!proof.ok) {
      return proof.code === 'CPF_INVALID'
        ? { ok: false, code: 'CPF_INVALID', message: 'CPF inválido', status: 422 }
        : { ok: false, code: 'OWNER_CPF_MISMATCH', message: 'O CPF informado não é o da sua conta Alber', status: 422 }
    }
    const verdict = evaluateOwnerCpf(proof.cpf, await (deps.registry ?? fetchCnpjRegistry)(cnpjClean))
    linkCheck = verdict.check
    linkQualification = verdict.qualification
  }
  const linkReview = reviewFor(linkCheck)

  const encSecret     = Deno.env.get('ASAAS_API_KEY')!
  const pixKeySecret   = Deno.env.get('ENCRYPTION_KEY')!
  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
  const webhookUrl     = `${supabaseUrl}/functions/v1/webhooks-asaas-kyc`
  const pixWebhookUrl  = `${supabaseUrl}/functions/v1/webhooks-asaas-pix`
  const ownerPhone     = (owner.phone ?? '').replace(/\D/g, '')

  // A Asaas exige e-mail único por subconta dentro da mesma conta pai — usar o
  // e-mail pessoal do dono aqui colide com a subconta pessoal dele (sempre:
  // toda empresa tem um dono que, se tem carteira pessoal, já usou esse e-mail
  // na própria subconta). O CNPJ é único por definição, então serve de base
  // pra um endereço sintético só da empresa (mesmo domínio-placeholder já usado
  // pelo campo `email` dos webhooks, ver createAsaasAccount).
  const companyAsaasEmail = `empresa-${cnpjClean}@usealber.com`

  const accountInput = (email: string) => ({
    name:          input.company_name,
    email,
    // O login do painel do Asaas fica SEMPRE no endereço sintético (que ninguém lê), mesmo com e-mail de contato real: assim ninguém
    // recupera a senha da subconta e entra no painel do Asaas, fora do PIN, da chave Pix e dos limites do Alber.
    loginEmail:    companyAsaasEmail,
    cpfCnpj:       cnpjClean,
    companyType:   input.company_type,
    tradingName:   input.trading_name,
    taxRegime:     input.tax_regime,
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
  })

  // E-mail real da empresa primeiro; se o Asaas disser que já está em uso, o mesmo com +cnpj. Sem e-mail informado, o sintético de sempre.
  const emailCandidates = contactEmail ? [contactEmail, plusAliasEmail(contactEmail, cnpjClean)] : [companyAsaasEmail]

  let asaasAccount: { id: string; apiKey: string; walletId: string } | undefined
  for (const [attempt, candidate] of emailCandidates.entries()) {
    try {
      asaasAccount = await createAsaasAccount(accountInput(candidate), encSecret)
      break
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

      const lower      = description.toLowerCase()
      const inUse      = lower.includes('já está em uso')
      const isEmailDup = inUse && (lower.includes('e-mail') || lower.includes('email'))
      const isDup      = inUse && (lower.includes('cpf') || lower.includes('cnpj'))

      if (isEmailDup && attempt < emailCandidates.length - 1) continue // tenta o e-mail com +cnpj

      if (!isDup) {
        await logError(supabaseAdmin, 'company-create', e, { cnpj: `${cnpjClean.slice(0, 8)}***` }, {
          asaas_response: asaasErrorBody,
        })
        return { ok: false, code: 'ASAAS_ERROR', message: description || 'Erro ao criar subconta financeira', status: 503 }
      }

      // O CNPJ já tem subconta no Asaas (tentativa anterior abandonada ou recusada). Reaproveitá-la só com o vínculo conferido: sem isso,
      // quem não é sócio herdaria a subconta (e os dados de contato) de uma tentativa anterior.
      if (linkCheck !== 'match') {
        return { ok: false, code: 'CNPJ_IN_USE', message: description, status: 409 }
      }
      const existing = await getAsaasAccountByCpf(cnpjClean, encSecret)
      if (!existing) {
        return { ok: false, code: 'CNPJ_IN_USE', message: description, status: 409 }
      }
      asaasAccount = existing
      break
    }
  }
  if (!asaasAccount) return { ok: false, code: 'ASAAS_ERROR', message: 'Erro ao criar subconta financeira', status: 503 }

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

  // ── Chave Pix de SAQUE da empresa (distinta da de recebimento acima) ─────────
  // 'cnpj': reusa o próprio CNPJ já validado — nenhuma chamada à Asaas necessária.
  // 'random': registra uma EVP nova na subconta (igual company-set-pix-key faria
  // depois, só que já no cadastro). Best-effort: falha aqui não derruba a criação
  // da empresa — fica sem chave e o master configura depois manualmente.
  let withdrawalKeyEnc:  string | null = null
  let withdrawalKeyType: 'cnpj' | 'random' | null = null
  if (input.pix_key_type === 'cnpj') {
    withdrawalKeyEnc  = await aesEncrypt(cnpjClean, pixKeySecret)
    withdrawalKeyType = 'cnpj'
  } else if (input.pix_key_type === 'random' && asaasAccount.apiKey) {
    try {
      const { key } = await createPixAddressKey('EVP', asaasAccount.apiKey)
      withdrawalKeyEnc  = await aesEncrypt(key, pixKeySecret)
      withdrawalKeyType = 'random'
    } catch (e) {
      console.warn('[company-create] erro ao registrar chave Pix de saque (não-crítico):', e)
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
      pix_key:           withdrawalKeyEnc,
      pix_key_type:      withdrawalKeyType,
      cnpj:              cnpjHash,
      cnpj_masked:       cnpjMasked,
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
      owner_link_check:         linkCheck,
      owner_link_review:        linkReview,
      owner_link_qualification: linkQualification,
      owner_link_checked_at:    linkCheck === 'unchecked' ? null : new Date().toISOString(),
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
    owner_link_check:  linkCheck,
    owner_link_review: linkReview,
  }
}
