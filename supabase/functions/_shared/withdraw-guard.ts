// Guarda de saída do dinheiro de EMPRESA (descarregar para Pix e transferir para outro Alber). É o backstop contra fraude: vale mesmo
// que uma conferência de abertura seja enganada (ver docs/plano-conferencia-cnpj-administrador.md no repositório do Alber Food, fase 1).
//
// Regras (decisão de 03/11/2026):
//   1. Vínculo do responsável em revisão (pending) ou recusado (rejected): NÃO saca. `legacy` (empresa anterior à regra) não bloqueia.
//   2. Chave Pix de saque ALEATÓRIA cadastrada há menos de 48 h: NÃO saca (a chave só é gravada uma vez; a espera dá tempo de o dono reagir ao aviso).
//      A chave do tipo CNPJ não espera: o destino é a conta do próprio CNPJ.
//   3. Limites de valor, por saque e por dia (últimas 24 h, somando descarregar e transferir da empresa):
//        primeiros 30 dias depois da aprovação do KYC: R$ 1.000 por saque e R$ 2.000 por dia
//        depois disso:                                  R$ 5.000 por saque e R$ 20.000 por dia
//      Acima do limite o pedido é recusado (código WITHDRAW_LIMIT_*).
//   4. AUMENTO DE LIMITE (decisão de 04/11/2026): o dono (master) PEDE o aumento (função company-limit-request) e a equipe do Alber APROVA no
//      Alber Admin. O que a equipe aprova fica em companies.withdraw_limit_per_tx_brl / _per_day_brl e substitui os limites padrão (os dois
//      juntos) até a equipe voltar aos padrões. O aumento mexe SÓ nos limites de valor: vínculo em revisão ou recusado e a espera da chave Pix
//      continuam valendo.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0'

export const WITHDRAW_RULES = {
  newCompanyDays: 30,
  newPerTxBrl: 1_000,
  newPerDayBrl: 2_000,
  perTxBrl: 5_000,
  perDayBrl: 20_000,
  pixKeyWaitHours: 48,
} as const

/** Tetos de um pedido de aumento (os mesmos que a função SQL admin_decide_limit_request impõe). */
export const LIMIT_REQUEST_CAPS = { perTxBrl: 500_000, perDayBrl: 2_000_000 } as const

const HOUR = 3_600_000
const DAY = 24 * HOUR

export interface WithdrawFacts {
  ownerLinkReview: string
  /** Quando o Asaas aprovou a empresa. Sem data (empresa antiga ou ainda não aprovada) = tratada como nova. */
  kycApprovedAt: string | null
  /** Quando a chave Pix de saque ALEATÓRIA foi cadastrada (null = chave do CNPJ ou nenhuma). */
  pixKeyChangedAt: string | null
  /** Valor deste pedido, em reais. */
  amountBrl: number
  /** Soma dos saques da empresa nas últimas 24 h (descarregar + transferir, exceto falhos), sem este pedido. */
  sumLast24hBrl: number
  /** Limites aprovados pela equipe (pedido de aumento). Os dois juntos ou nenhum; ausentes = padrão pela idade da empresa. */
  overridePerTxBrl?: number | null
  overridePerDayBrl?: number | null
  now: Date
}

export interface EffectiveLimits {
  perTxBrl: number
  perDayBrl: number
  /** 'approved' = definidos pela equipe a pedido do dono; 'default' = regra por idade da empresa. */
  source: 'default' | 'approved'
  /** Dentro dos primeiros 30 dias depois da aprovação do KYC (só vale para source 'default'). */
  isNew: boolean
}

/** Limites que valem agora para a empresa: o aprovado pela equipe, se houver, senão o padrão pela idade. */
export function effectiveLimits(f: Pick<WithdrawFacts, 'kycApprovedAt' | 'overridePerTxBrl' | 'overridePerDayBrl' | 'now'>): EffectiveLimits {
  const approved = f.kycApprovedAt ? new Date(f.kycApprovedAt).getTime() : null
  const isNew = approved === null || f.now.getTime() - approved < WITHDRAW_RULES.newCompanyDays * DAY
  const tx = f.overridePerTxBrl == null ? null : Number(f.overridePerTxBrl)
  const day = f.overridePerDayBrl == null ? null : Number(f.overridePerDayBrl)
  if (tx !== null && day !== null && Number.isFinite(tx) && Number.isFinite(day) && tx > 0 && day >= tx) {
    return { perTxBrl: tx, perDayBrl: day, source: 'approved', isNew }
  }
  return { perTxBrl: isNew ? WITHDRAW_RULES.newPerTxBrl : WITHDRAW_RULES.perTxBrl, perDayBrl: isNew ? WITHDRAW_RULES.newPerDayBrl : WITHDRAW_RULES.perDayBrl, source: 'default', isNew }
}

export type WithdrawVerdict = { ok: true } | { ok: false; code: string; message: string; status: number; extra?: Record<string, unknown> }

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR')}`

export function evaluateWithdrawal(f: WithdrawFacts): WithdrawVerdict {
  if (f.ownerLinkReview === 'rejected') {
    return { ok: false, code: 'OWNER_LINK_REJECTED', message: 'A conferência do seu vínculo com a empresa foi recusada. Fale com o suporte.', status: 403 }
  }
  if (f.ownerLinkReview === 'pending') {
    return { ok: false, code: 'OWNER_LINK_PENDING', message: 'Estamos conferindo o seu vínculo com a empresa. Os saques ficam bloqueados até a conferência terminar.', status: 403 }
  }

  if (f.pixKeyChangedAt) {
    const unlocks = new Date(f.pixKeyChangedAt).getTime() + WITHDRAW_RULES.pixKeyWaitHours * HOUR
    if (f.now.getTime() < unlocks) {
      return {
        ok: false,
        code: 'PIX_KEY_RECENTLY_CHANGED',
        message: `A chave Pix de saque foi cadastrada há pouco. Os saques voltam ${WITHDRAW_RULES.pixKeyWaitHours} horas depois do cadastro. Se não foi você, fale com o suporte agora.`,
        status: 403,
        extra: { available_at: new Date(unlocks).toISOString() },
      }
    }
  }

  const lim = effectiveLimits(f)
  const perTx = lim.perTxBrl
  const perDay = lim.perDayBrl
  const newNote = lim.source === 'default' && lim.isNew ? ' nos primeiros 30 dias' : ''

  if (f.amountBrl > perTx) {
    return { ok: false, code: 'WITHDRAW_LIMIT_PER_TX', message: `O limite por saque da empresa é ${brl(perTx)}${newNote}. Para valores maiores, peça um aumento do limite no portal do restaurante ou fale com o suporte.`, status: 422, extra: { limit_brl: perTx } }
  }
  if (f.sumLast24hBrl + f.amountBrl > perDay) {
    return { ok: false, code: 'WITHDRAW_LIMIT_DAILY', message: `O limite diário de saques da empresa é ${brl(perDay)}${newNote}. Tente de novo mais tarde, peça um aumento do limite no portal do restaurante ou fale com o suporte.`, status: 422, extra: { limit_brl: perDay } }
  }
  return { ok: true }
}

/** Lê os fatos da empresa no banco e aplica as regras. Erro de leitura NÃO libera: na dúvida, recusa. */
export async function checkCompanyWithdrawal(supabaseAdmin: SupabaseClient, companyId: string, amountBrl: number, now: Date = new Date()): Promise<WithdrawVerdict> {
  const { data: company, error } = await supabaseAdmin
    .from('companies')
    .select('owner_link_review, kyc_approved_at, pix_key_changed_at, withdraw_limit_per_tx_brl, withdraw_limit_per_day_brl')
    .eq('id', companyId)
    .maybeSingle()
  if (error || !company) return { ok: false, code: 'WITHDRAW_CHECK_FAILED', message: 'Não foi possível conferir o saque agora. Tente novamente.', status: 503 }

  const since = new Date(now.getTime() - DAY).toISOString()
  const { data: recent, error: sumErr } = await supabaseAdmin
    .from('transactions')
    .select('amount')
    .eq('company_id', companyId)
    .in('type', ['descarregar', 'transferir_enviado'])
    .neq('status', 'failed')
    .gte('created_at', since)
  if (sumErr) return { ok: false, code: 'WITHDRAW_CHECK_FAILED', message: 'Não foi possível conferir o saque agora. Tente novamente.', status: 503 }
  const sum = (recent ?? []).reduce((s: number, r: { amount: number | string }) => s + Number(r.amount ?? 0), 0)

  return evaluateWithdrawal({
    ownerLinkReview: company.owner_link_review as string,
    kycApprovedAt: (company.kyc_approved_at as string | null) ?? null,
    pixKeyChangedAt: (company.pix_key_changed_at as string | null) ?? null,
    overridePerTxBrl: company.withdraw_limit_per_tx_brl == null ? null : Number(company.withdraw_limit_per_tx_brl),
    overridePerDayBrl: company.withdraw_limit_per_day_brl == null ? null : Number(company.withdraw_limit_per_day_brl),
    amountBrl: amountBrl,
    sumLast24hBrl: sum,
    now,
  })
}
