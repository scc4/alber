// Pedido de aumento do limite de saque da empresa (decisão de 04/11/2026): o dono PEDE e a equipe do Alber APROVA no Alber Admin.
// Regras compartilhadas por company-limit-request (app, dono é um usuário) e food-company-limit-request / food-company-limit-cancel (Alber Food,
// dono é só um owner_ref). Quem chama já autenticou e já provou que o ator é o dono da empresa. Aqui ficam as regras do pedido, iguais nos dois.
// Só empresa aprovada no KYC e com o vínculo do responsável em ordem pede (vínculo em revisão ou recusado já bloqueia saque, então aumento de
// limite não adianta). Um pedido aberto por empresa; 3 pedidos por dia. O aprovado substitui os limites padrão (withdraw-guard.ts).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { effectiveLimits, LIMIT_REQUEST_CAPS } from './withdraw-guard.ts'

export const MAX_LIMIT_REQUESTS_PER_DAY = 3
const cents = (n: number) => Math.round(n * 100) / 100

/** Quem pede: um usuário do app (`userId`) ou o dono de uma empresa do Alber Food (`ownerRef`). */
export type LimitActor = { userId: string; ownerRef?: undefined } | { ownerRef: string; userId?: undefined }

/** Colunas de companies que o pedido precisa. */
export interface LimitCompany {
  id: string
  kyc_status: string
  kyc_approved_at?: string | null
  owner_link_review: string
  withdraw_limit_per_tx_brl?: number | string | null
  withdraw_limit_per_day_brl?: number | string | null
}

export const LIMIT_COMPANY_COLUMNS = 'id, kyc_status, kyc_approved_at, owner_link_review, withdraw_limit_per_tx_brl, withdraw_limit_per_day_brl'

export type LimitOutcome =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> }

const refuse = (code: string, message: string, status: number, extra?: Record<string, unknown>): LimitOutcome => ({ ok: false, code, message, status, extra })

const auditRow = (actor: LimitActor, eventType: string, metadata: Record<string, unknown>) => ({
  user_id: actor.userId ?? null,
  event_type: eventType,
  metadata: actor.ownerRef ? { ...metadata, owner_ref: actor.ownerRef, via: 'food' } : metadata,
})

/** Cancela o pedido em aberto da empresa. */
export async function cancelLimitRequest(supabaseAdmin: SupabaseClient, company: Pick<LimitCompany, 'id'>, actor: LimitActor): Promise<LimitOutcome> {
  const { data: cancelled, error: cancelErr } = await supabaseAdmin
    .from('company_limit_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('company_id', company.id)
    .eq('status', 'pending')
    .select('id')
  if (cancelErr) return refuse('DB_ERROR', 'Erro ao cancelar o pedido', 500)
  if (!cancelled || cancelled.length === 0) return refuse('LIMIT_REQUEST_NOT_FOUND', 'Não há pedido em aberto', 404)
  await supabaseAdmin.from('audit_logs').insert(auditRow(actor, 'company_limit_cancelled', { company_id: company.id, request_id: cancelled[0].id })).then(() => {}, () => {})
  return { ok: true, status: 200, body: { status: 'cancelled' } }
}

/** Registra um pedido de aumento. `raw*` são os valores como vieram do corpo (validados aqui). */
export async function createLimitRequest(
  supabaseAdmin: SupabaseClient,
  company: LimitCompany,
  actor: LimitActor,
  raw: { per_tx_brl?: unknown; per_day_brl?: unknown; reason?: unknown },
  now: Date = new Date(),
): Promise<LimitOutcome> {
  if (company.kyc_status !== 'approved') return refuse('COMPANY_NOT_APPROVED', 'A empresa precisa estar verificada para pedir aumento de limite', 422)
  if (company.owner_link_review === 'pending') return refuse('OWNER_LINK_PENDING', 'Estamos conferindo o seu vínculo com a empresa. Peça o aumento depois da conferência.', 403)
  if (company.owner_link_review === 'rejected') return refuse('OWNER_LINK_REJECTED', 'A conferência do seu vínculo com a empresa foi recusada. Fale com o suporte.', 403)

  const perTx = typeof raw.per_tx_brl === 'number' || typeof raw.per_tx_brl === 'string' ? cents(Number(raw.per_tx_brl)) : NaN
  const perDay = typeof raw.per_day_brl === 'number' || typeof raw.per_day_brl === 'string' ? cents(Number(raw.per_day_brl)) : NaN
  if (!Number.isFinite(perTx) || !Number.isFinite(perDay) || perTx <= 0 || perDay < perTx) {
    return refuse('LIMIT_INVALID', 'Informe o limite por saque e o limite por dia (o do dia não pode ser menor que o do saque)', 422)
  }
  if (perTx > LIMIT_REQUEST_CAPS.perTxBrl || perDay > LIMIT_REQUEST_CAPS.perDayBrl) {
    return refuse('LIMIT_ABOVE_CAP', 'Esse valor passa do máximo que a análise automática aceita. Fale com o suporte.', 422, { max_per_tx_brl: LIMIT_REQUEST_CAPS.perTxBrl, max_per_day_brl: LIMIT_REQUEST_CAPS.perDayBrl })
  }
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
  if (reason.length < 10 || reason.length > 500) return refuse('REASON_INVALID', 'Explique o motivo em 10 a 500 caracteres', 422)

  const current = effectiveLimits({
    kycApprovedAt: (company.kyc_approved_at as string | null | undefined) ?? null,
    overridePerTxBrl: company.withdraw_limit_per_tx_brl == null ? null : Number(company.withdraw_limit_per_tx_brl),
    overridePerDayBrl: company.withdraw_limit_per_day_brl == null ? null : Number(company.withdraw_limit_per_day_brl),
    now,
  })
  // O aprovado substitui os dois limites juntos; então o pedido não pode baixar nenhum e tem de subir pelo menos um.
  if (perTx < current.perTxBrl || perDay < current.perDayBrl || (perTx === current.perTxBrl && perDay === current.perDayBrl)) {
    return refuse('LIMIT_NOT_HIGHER', 'O pedido precisa aumentar o limite atual sem diminuir nenhum dos dois', 422, { current_per_tx_brl: current.perTxBrl, current_per_day_brl: current.perDayBrl })
  }

  const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString()
  const { count: recent } = await supabaseAdmin
    .from('company_limit_requests').select('id', { count: 'exact', head: true }).eq('company_id', company.id).gte('created_at', dayAgo)
  if ((recent ?? 0) >= MAX_LIMIT_REQUESTS_PER_DAY) return refuse('RATE_LIMITED', 'Muitos pedidos hoje. Tente novamente amanhã.', 429)

  const { data: pending } = await supabaseAdmin.from('company_limit_requests').select('id').eq('company_id', company.id).eq('status', 'pending').maybeSingle()
  if (pending) return refuse('LIMIT_REQUEST_PENDING', 'Já existe um pedido de aumento em análise para esta empresa', 409)

  const { data: created, error: insErr } = await supabaseAdmin
    .from('company_limit_requests')
    .insert({
      company_id: company.id,
      ...(actor.userId ? { requested_by: actor.userId } : { requested_by_ref: actor.ownerRef }),
      requested_per_tx_brl: perTx,
      requested_per_day_brl: perDay,
      current_per_tx_brl: current.perTxBrl,
      current_per_day_brl: current.perDayBrl,
      reason,
    })
    .select('id, status, requested_per_tx_brl, requested_per_day_brl, current_per_tx_brl, current_per_day_brl, created_at')
    .single()
  if (insErr || !created) {
    // Duas chamadas ao mesmo tempo: o índice único deixa passar só uma.
    if ((insErr as { code?: string } | null)?.code === '23505') return refuse('LIMIT_REQUEST_PENDING', 'Já existe um pedido de aumento em análise para esta empresa', 409)
    return refuse('DB_ERROR', 'Erro ao registrar o pedido', 500)
  }

  // O motivo é texto livre do cliente: fica só no pedido, nunca na auditoria.
  await supabaseAdmin.from('audit_logs').insert(auditRow(actor, 'company_limit_requested', { company_id: company.id, request_id: created.id, per_tx_brl: perTx, per_day_brl: perDay })).then(() => {}, () => {})

  return {
    ok: true,
    status: 201,
    body: {
      request: {
        id: created.id,
        status: created.status,
        requested_per_tx_brl: Number(created.requested_per_tx_brl),
        requested_per_day_brl: Number(created.requested_per_day_brl),
        current_per_tx_brl: Number(created.current_per_tx_brl),
        current_per_day_brl: Number(created.current_per_day_brl),
        created_at: created.created_at,
      },
    },
  }
}
