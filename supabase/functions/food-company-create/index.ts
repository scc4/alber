// POST /food-company-create   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário; verify_jwt padrão, como as takeaway-*)
//   { owner_ref: uuid, owner: { cpf, name, phone, email? },
//     company: { cnpj, company_name, trading_name?, company_type, email?, tax_regime?,
//                address: { street, number, complement?, district, cep, city, state }, income_value, handle } }
//   -> 201 { company_id, handle, kyc_status, account_status, onboarding_url|null, owner_link_check, owner_link_review }
//
// Abre a subconta PJ de um restaurante do Alber Food SEM usuário do app: o dono é só o `owner_ref` (id da conta no Alber Food) e o CPF vem
// do cadastro dessa conta (nunca de um campo digitado), então não há prova de hash. Reaproveita createCompanyForOwner (_shared/company.ts):
// conferência do vínculo pelo quadro societário (dígitos 4 a 9 do CPF), disputa de CNPJ, subconta órfã nunca reaproveitada, e os mesmos erros
// de company-create (CNPJ_UNDER_REVIEW, CNPJ_IN_USE, CNPJ_DUPLICATE, COMPANY_HANDLE_TAKEN...).
// Repetir a chamada do MESMO dono para o MESMO CNPJ devolve a empresa já aberta (200), sem criar outra subconta.
// Limite: 5 aberturas por dono a cada 15 minutos (cada sucesso cria uma subconta real no Asaas).

import { handleCors, json, err } from '../_shared/cors.ts'
import { createCompanyForOwner, type CreateCompanyDeps, type CreateCompanyInput } from '../_shared/company.ts'
import { adminClient, isObject, readServiceBody, sha256hex } from '../_shared/food-company.ts'
import { UUID } from '../_shared/food-service.ts'
import { normalizeCnpj, validateCnpj } from '../_shared/cnpj.ts'
import { logError } from '../_shared/error-log.ts'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export async function handleRequest(req: Request, deps: CreateCompanyDeps = {}): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const { body } = parsed

  const ownerRef = str(body.owner_ref) ?? ''
  if (!UUID.test(ownerRef)) return err('INVALID_OWNER', 'owner_ref inválido', 422)
  const owner = body.owner
  const company = body.company
  if (!isObject(owner) || !isObject(company)) return err('MISSING_FIELDS', 'owner e company são obrigatórios', 400)
  const address = isObject(company.address) ? company.address : null
  if (!address) return err('MISSING_FIELDS', 'company.address é obrigatório', 400)

  const cpf = str(owner.cpf) ?? ''
  const name = (str(owner.name) ?? '').trim()
  const phoneDigits = (str(owner.phone) ?? '').replace(/\D/g, '')
  if (!cpf) return err('MISSING_FIELDS', 'owner.cpf é obrigatório', 400)
  if (name.length < 2 || name.length > 120) return err('INVALID_OWNER', 'owner.name inválido', 422)
  if (!/^\d{10,11}$/.test(phoneDigits)) return err('INVALID_OWNER', 'owner.phone inválido', 422)

  if (typeof company.income_value !== 'number') return err('MISSING_FIELDS', 'company.income_value é obrigatório', 400)
  const input: CreateCompanyInput = {
    cnpj: str(company.cnpj) ?? '',
    handle: str(company.handle) ?? '',
    company_name: str(company.company_name) ?? '',
    trading_name: str(company.trading_name),
    company_type: company.company_type as CreateCompanyInput['company_type'],
    income_value: company.income_value,
    email: company.email == null ? undefined : (company.email as string),
    tax_regime: company.tax_regime == null ? undefined : (company.tax_regime as CreateCompanyInput['tax_regime']),
    address: {
      street: str(address.street) ?? '',
      number: str(address.number) ?? '',
      complement: str(address.complement),
      neighborhood: str(address.district) ?? '',
      zip_code: str(address.cep) ?? '',
      city: str(address.city),
      state: str(address.state),
    },
  }
  if (!input.handle) return err('MISSING_FIELDS', 'company.handle é obrigatório', 400)

  const supabaseAdmin = adminClient()

  // Repetição do mesmo dono para o mesmo CNPJ (ex.: timeout na chamada anterior): devolve a empresa que já existe.
  const cnpjClean = normalizeCnpj(input.cnpj)
  if (validateCnpj(cnpjClean)) {
    const { data: mine } = await supabaseAdmin
      .from('companies')
      .select('id, handle, kyc_status, account_status, onboarding_url, owner_link_check, owner_link_review')
      .eq('cnpj', await sha256hex(cnpjClean))
      .eq('owner_ref', ownerRef)
      .is('deleted_at', null)
      .maybeSingle()
    if (mine) {
      const m = mine as Record<string, unknown>
      return json({
        company_id: m.id, handle: m.handle, kyc_status: m.kyc_status, account_status: m.account_status,
        onboarding_url: m.onboarding_url ?? null, owner_link_check: m.owner_link_check, owner_link_review: m.owner_link_review,
      }, 200)
    }
  }

  // Limite de aberturas por dono (cada sucesso cria uma subconta real no Asaas).
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'food_company_create_attempt')
    .eq('metadata->>owner_ref', ownerRef)
    .gte('created_at', since)
  if ((attempts ?? 0) >= 5) return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  await supabaseAdmin.from('audit_logs').insert({ user_id: null, event_type: 'food_company_create_attempt', metadata: { owner_ref: ownerRef } }).then(() => {}, () => {})

  const result = await createCompanyForOwner(supabaseAdmin, { kind: 'food', ref: ownerRef, cpf, phone: phoneDigits }, input, deps)
  if (!result.ok) {
    if (result.code === 'DB_ERROR') await logError(supabaseAdmin, 'food-company-create', new Error(result.message), { owner_ref: ownerRef })
    return err(result.code, result.message, result.status)
  }

  await supabaseAdmin.from('audit_logs').insert({ user_id: null, event_type: 'food_company_create', metadata: { owner_ref: ownerRef, company_id: result.company_id } }).then(() => {}, () => {})

  return json({
    company_id: result.company_id,
    handle: result.handle,
    kyc_status: result.kyc_status,
    account_status: result.account_status,
    onboarding_url: result.onboarding_url,
    owner_link_check: result.owner_link_check,
    owner_link_review: result.owner_link_review,
  }, 201)
}

if (import.meta.main) {
  Deno.serve((req) => handleRequest(req))
}
