// POST /food-company-status   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário)
//   { company_id, owner_ref }
//   -> { company_id, handle, kyc_status, account_status, onboarding_url|null, owner_link_check, owner_link_review,
//        pix_key: { configured, type: 'cnpj'|'random'|null, masked|null, digest|null, changed_at|null, available_at|null },
//        limits: { per_tx_brl, per_day_brl, source: 'default'|'approved' }, last_limit_request|null,
//        withdraw: { allowed, code|null, message|null } }
//
// Faz a consulta de KYC que company-list faz para empresa pendente (pollCompanyKyc: o webhook pode não chegar e no sandbox a aprovação é
// automática) e uma pré-checagem da guarda de saque (vínculo, carência da chave, limites), sem valor: o limite por valor o Food compara com
// `limits`. Somente leitura para o dinheiro. Nunca devolve chave Pix, chave de subconta nem CPF.

import { handleCors, json, err } from '../_shared/cors.ts'
import { pollCompanyKyc } from '../_shared/company-kyc.ts'
import { checkCompanyWithdrawal, effectiveLimits } from '../_shared/withdraw-guard.ts'
import { adminClient, isOperational, loadOwnedCompany, pixKeyView, readIds, readServiceBody, type FoodCompany } from '../_shared/food-company.ts'

const POLL_TIMEOUT_MS = 8000

/** Consulta o Asaas sem passar de POLL_TIMEOUT_MS (a falha ou a lentidão não derrubam a leitura). */
async function pollWithTimeout(supabaseAdmin: ReturnType<typeof adminClient>, companyId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([pollCompanyKyc(supabaseAdmin, companyId), new Promise<void>((resolve) => { timer = setTimeout(resolve, POLL_TIMEOUT_MS) })])
  } finally {
    clearTimeout(timer)
  }
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const ids = readIds(parsed.body)
  if (!ids.ok) return ids.res

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
  if (!loaded.ok) return loaded.res
  let company: FoodCompany = loaded.company

  // Empresa pendente: pergunta ao Asaas e relê (só APROVA; a rejeição vem pelo webhook, que remove a empresa).
  if (company.kyc_status === 'pending' || company.kyc_status === 'submitted') {
    await pollWithTimeout(supabaseAdmin, company.id)
    const again = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
    if (!again.ok) return again.res
    company = again.company
  }

  const limits = effectiveLimits({
    kycApprovedAt: company.kyc_approved_at ?? null,
    overridePerTxBrl: company.withdraw_limit_per_tx_brl == null ? null : Number(company.withdraw_limit_per_tx_brl),
    overridePerDayBrl: company.withdraw_limit_per_day_brl == null ? null : Number(company.withdraw_limit_per_day_brl),
    now: new Date(),
  })

  const { data: lastReq } = await supabaseAdmin
    .from('company_limit_requests')
    .select('id, status, requested_per_tx_brl, requested_per_day_brl, approved_per_tx_brl, approved_per_day_brl, created_at, decided_at')
    .eq('company_id', company.id)
    .order('created_at', { ascending: false })
    .limit(1)
  const last = Array.isArray(lastReq) ? (lastReq[0] as Record<string, unknown> | undefined) : undefined

  const pix_key = await pixKeyView(company)

  // Pré-checagem do saque: na ordem em que food-company-withdraw recusaria.
  let withdraw: { allowed: boolean; code: string | null; message: string | null } = { allowed: true, code: null, message: null }
  if (!isOperational(company)) {
    withdraw = { allowed: false, code: 'COMPANY_NOT_APPROVED', message: 'Empresa sem conta aprovada' }
  } else if (!pix_key.configured) {
    withdraw = { allowed: false, code: 'COMPANY_PIX_KEY_NOT_CONFIGURED', message: 'Chave Pix da empresa ainda não configurada' }
  } else {
    const verdict = await checkCompanyWithdrawal(supabaseAdmin, company.id, 0)
    if (!verdict.ok) withdraw = { allowed: false, code: verdict.code, message: verdict.message }
  }

  return json({
    company_id: company.id,
    handle: company.handle,
    kyc_status: company.kyc_status,
    account_status: company.account_status,
    onboarding_url: company.onboarding_url ?? null,
    owner_link_check: company.owner_link_check,
    owner_link_review: company.owner_link_review,
    pix_key,
    limits: { per_tx_brl: limits.perTxBrl, per_day_brl: limits.perDayBrl, source: limits.source },
    last_limit_request: last
      ? {
        id: last.id,
        status: last.status,
        requested_per_tx_brl: Number(last.requested_per_tx_brl),
        requested_per_day_brl: Number(last.requested_per_day_brl),
        approved_per_tx_brl: last.approved_per_tx_brl == null ? null : Number(last.approved_per_tx_brl),
        approved_per_day_brl: last.approved_per_day_brl == null ? null : Number(last.approved_per_day_brl),
        created_at: last.created_at,
        decided_at: last.decided_at,
      }
      : null,
    withdraw,
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
