// POST /company-limit-request
//   Pedir:    { company_id, per_tx_brl, per_day_brl, reason }
//   Cancelar: { company_id, cancel: true }
// O dono (master) PEDE o aumento do limite de saque da empresa; a equipe do Alber decide no Alber Admin (public.admin_decide_limit_request).
// Só empresa aprovada no KYC e com o vínculo do responsável em ordem pede (vínculo em revisão ou recusado já bloqueia saque, então aumento
// de limite não adianta). Um pedido aberto por empresa; 3 pedidos por dia. O aprovado substitui os limites padrão (withdraw-guard.ts).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { effectiveLimits, LIMIT_REQUEST_CAPS } from '../_shared/withdraw-guard.ts'

const MAX_REQUESTS_PER_DAY = 3
const cents = (n: number) => Math.round(n * 100) / 100

interface LimitRequestBody {
  company_id?: string
  per_tx_brl?: unknown
  per_day_brl?: unknown
  reason?: unknown
  cancel?: unknown
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)
  const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: LimitRequestBody
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  if (!body.company_id) return err('MISSING_FIELDS', 'company_id é obrigatório', 400)

  const { data: caller } = await supabaseAdmin.from('users').select('id, deleted_at').eq('auth_id', authUser.id).maybeSingle()
  if (!caller || caller.deleted_at) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, kyc_status, kyc_approved_at, owner_link_review, deleted_at, withdraw_limit_per_tx_brl, withdraw_limit_per_day_brl')
    .eq('id', body.company_id)
    .maybeSingle()
  if (!company || company.deleted_at) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)
  // Só o master: um operador não pede aumento de limite.
  if (company.owner_id !== caller.id) return err('FORBIDDEN', 'Só o master pede aumento do limite da empresa', 403)

  // ── Cancelar o pedido em aberto ───────────────────────────────────────────────────────────────────────────────────────────────
  if (body.cancel === true) {
    const { data: cancelled, error: cancelErr } = await supabaseAdmin
      .from('company_limit_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('company_id', company.id)
      .eq('status', 'pending')
      .select('id')
    if (cancelErr) return err('DB_ERROR', 'Erro ao cancelar o pedido', 500)
    if (!cancelled || cancelled.length === 0) return err('LIMIT_REQUEST_NOT_FOUND', 'Não há pedido em aberto', 404)
    await supabaseAdmin.from('audit_logs').insert({ user_id: caller.id, event_type: 'company_limit_cancelled', metadata: { company_id: company.id, request_id: cancelled[0].id } }).then(() => {}, () => {})
    return json({ status: 'cancelled' })
  }

  // ── Pedir ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (company.kyc_status !== 'approved') return err('COMPANY_NOT_APPROVED', 'A empresa precisa estar verificada para pedir aumento de limite', 422)
  if (company.owner_link_review === 'pending') return err('OWNER_LINK_PENDING', 'Estamos conferindo o seu vínculo com a empresa. Peça o aumento depois da conferência.', 403)
  if (company.owner_link_review === 'rejected') return err('OWNER_LINK_REJECTED', 'A conferência do seu vínculo com a empresa foi recusada. Fale com o suporte.', 403)

  const perTx = typeof body.per_tx_brl === 'number' || typeof body.per_tx_brl === 'string' ? cents(Number(body.per_tx_brl)) : NaN
  const perDay = typeof body.per_day_brl === 'number' || typeof body.per_day_brl === 'string' ? cents(Number(body.per_day_brl)) : NaN
  if (!Number.isFinite(perTx) || !Number.isFinite(perDay) || perTx <= 0 || perDay < perTx) {
    return err('LIMIT_INVALID', 'Informe o limite por saque e o limite por dia (o do dia não pode ser menor que o do saque)', 422)
  }
  if (perTx > LIMIT_REQUEST_CAPS.perTxBrl || perDay > LIMIT_REQUEST_CAPS.perDayBrl) {
    return err('LIMIT_ABOVE_CAP', 'Esse valor passa do máximo que a análise automática aceita. Fale com o suporte.', 422, { max_per_tx_brl: LIMIT_REQUEST_CAPS.perTxBrl, max_per_day_brl: LIMIT_REQUEST_CAPS.perDayBrl })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 10 || reason.length > 500) return err('REASON_INVALID', 'Explique o motivo em 10 a 500 caracteres', 422)

  const current = effectiveLimits({
    kycApprovedAt: (company.kyc_approved_at as string | null) ?? null,
    overridePerTxBrl: company.withdraw_limit_per_tx_brl == null ? null : Number(company.withdraw_limit_per_tx_brl),
    overridePerDayBrl: company.withdraw_limit_per_day_brl == null ? null : Number(company.withdraw_limit_per_day_brl),
    now: new Date(),
  })
  // O aprovado substitui os dois limites juntos; então o pedido não pode baixar nenhum e tem de subir pelo menos um.
  if (perTx < current.perTxBrl || perDay < current.perDayBrl || (perTx === current.perTxBrl && perDay === current.perDayBrl)) {
    return err('LIMIT_NOT_HIGHER', 'O pedido precisa aumentar o limite atual sem diminuir nenhum dos dois', 422, { current_per_tx_brl: current.perTxBrl, current_per_day_brl: current.perDayBrl })
  }

  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const { count: recent } = await supabaseAdmin
    .from('company_limit_requests').select('id', { count: 'exact', head: true }).eq('company_id', company.id).gte('created_at', dayAgo)
  if ((recent ?? 0) >= MAX_REQUESTS_PER_DAY) return err('RATE_LIMITED', 'Muitos pedidos hoje. Tente novamente amanhã.', 429)

  const { data: pending } = await supabaseAdmin.from('company_limit_requests').select('id').eq('company_id', company.id).eq('status', 'pending').maybeSingle()
  if (pending) return err('LIMIT_REQUEST_PENDING', 'Já existe um pedido de aumento em análise para esta empresa', 409)

  const { data: created, error: insErr } = await supabaseAdmin
    .from('company_limit_requests')
    .insert({
      company_id: company.id,
      requested_by: caller.id,
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
    if ((insErr as { code?: string } | null)?.code === '23505') return err('LIMIT_REQUEST_PENDING', 'Já existe um pedido de aumento em análise para esta empresa', 409)
    return err('DB_ERROR', 'Erro ao registrar o pedido', 500)
  }

  // O motivo é texto livre do cliente: fica só no pedido, nunca na auditoria.
  await supabaseAdmin.from('audit_logs').insert({
    user_id: caller.id,
    event_type: 'company_limit_requested',
    metadata: { company_id: company.id, request_id: created.id, per_tx_brl: perTx, per_day_brl: perDay },
  }).then(() => {}, () => {})

  return json({
    request: {
      id: created.id,
      status: created.status,
      requested_per_tx_brl: Number(created.requested_per_tx_brl),
      requested_per_day_brl: Number(created.requested_per_day_brl),
      current_per_tx_brl: Number(created.current_per_tx_brl),
      current_per_day_brl: Number(created.current_per_day_brl),
      created_at: created.created_at,
    },
  }, 201)
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
