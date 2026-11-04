// Peças comuns das funções food-company-* (API de serviço do Alber para o Alber Food). Contrato: specs/06_modules/food_company_service.md.
//
// Todas as funções: POST JSON, cabeçalho x-alber-food-key (requireFoodKey), SEM JWT de usuário (o dono não existe no Alber; a empresa só conhece
// `companies.owner_ref`). verify_jwt fica no padrão (ligado), como nas takeaway-*: o Alber Food manda o apikey/Authorization anônimo do projeto;
// quem autentica de verdade é a chave de serviço. Valores em CENTAVOS inteiros na API (1 Alber = R$ 1,00).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { err, json } from './cors.ts'
import { requireFoodKey, UUID } from './food-service.ts'
import { aesDecrypt, sha256hex } from './crypto.ts'
import { logError } from './error-log.ts'
import {
  finishFoodOp, reserveFoodOp, verifyFoodOp, destinationDigest,
  type FoodOp, type FoodOpExpectation, type StoredResult,
} from './food-op.ts'
import { WITHDRAW_RULES } from './withdraw-guard.ts'

export { destinationDigest }

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// ── Taxa do saque do Alber Food ──────────────────────────────────────────────
// DECISÃO PENDENTE DO USUÁRIO (04/11/2026): hoje o saque do Alber Food NÃO cobra taxa. O descarregar do app cobra `rates.cashout` (padrão 2%) e
// a taxa vai para a conta pai; o relatório do contrato aponta essa cobrança como bloqueante para o Food, então fica desligada. Para ligar,
// troque a constante abaixo para true: food-company-withdraw já trata taxa > 0 (valor enviado = valor - taxa, lançamento de taxa e repasse à
// carteira da conta pai). É o ÚNICO ponto da regra.
export const FOOD_WITHDRAW_FEE_ENABLED = false

/** Taxa do saque em reais (0 enquanto desligada). */
export async function foodWithdrawFeeBrl(supabaseAdmin: SupabaseClient, amountBrl: number): Promise<number> {
  if (!FOOD_WITHDRAW_FEE_ENABLED) return 0
  const { data } = await supabaseAdmin.from('rates').select('rate').eq('type', 'cashout').maybeSingle()
  const rate = Number((data as { rate?: number | string } | null)?.rate ?? 0.02) // mesmo padrão de financial-descarregar
  return parseFloat((amountBrl * rate).toFixed(2))
}

// ── Corpo e validações ───────────────────────────────────────────────────────

export const OWNER_REF = /^[\x21-\x7e]{1,128}$/

/** Valor em centavos: inteiro. */
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
export const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Autentica o Alber Food (x-alber-food-key), lê o JSON e devolve o objeto. Senão, a resposta de erro. */
export async function readServiceBody(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  const denied = requireFoodKey(req)
  if (denied) return { ok: false, res: denied }
  let body: unknown
  try { body = await req.json() } catch { return { ok: false, res: err('INVALID_BODY', 'JSON inválido', 400) } }
  if (!isObject(body)) return { ok: false, res: err('INVALID_BODY', 'JSON inválido', 400) }
  return { ok: true, body }
}

export function readIds(body: Record<string, unknown>, ownerKey = 'owner_ref'): { ok: true; companyId: string; ownerRef: string } | { ok: false; res: Response } {
  const companyId = typeof body.company_id === 'string' ? body.company_id : ''
  const ownerRef = typeof body[ownerKey] === 'string' ? (body[ownerKey] as string) : ''
  if (!UUID.test(companyId)) return { ok: false, res: err('INVALID_COMPANY', 'company_id inválido', 422) }
  if (!OWNER_REF.test(ownerRef)) return { ok: false, res: err('INVALID_OWNER', `${ownerKey} inválido`, 422) }
  return { ok: true, companyId, ownerRef }
}

// ── Empresa ──────────────────────────────────────────────────────────────────

export const COMPANY_COLUMNS = [
  'id', 'handle', 'owner_ref', 'origin', 'cnpj', 'kyc_status', 'account_status', 'onboarding_url', 'deleted_at',
  'asaas_api_key_enc', 'asaas_wallet_id',
  'pix_key', 'pix_key_type', 'pix_key_hash', 'pix_key_changed_at', 'pix_key_set_at',
  'owner_link_check', 'owner_link_review', 'kyc_approved_at', 'withdraw_limit_per_tx_brl', 'withdraw_limit_per_day_brl',
].join(', ')

export interface FoodCompany {
  id: string
  handle: string
  owner_ref: string | null
  origin: string
  cnpj: string
  kyc_status: string
  account_status: string
  onboarding_url: string | null
  deleted_at: string | null
  asaas_api_key_enc: string | null
  asaas_wallet_id: string | null
  pix_key: string | null
  pix_key_type: 'cnpj' | 'random' | null
  pix_key_hash: string | null
  pix_key_changed_at: string | null
  pix_key_set_at: string | null
  owner_link_check: string
  owner_link_review: string
  kyc_approved_at: string | null
  withdraw_limit_per_tx_brl: number | string | null
  withdraw_limit_per_day_brl: number | string | null
}

/** Lê a empresa e confere que `ownerRef` é o dono dela. 404 (não existe ou foi removida) ou 403 NOT_OWNER. */
export async function loadOwnedCompany(supabaseAdmin: SupabaseClient, companyId: string, ownerRef: string): Promise<{ ok: true; company: FoodCompany } | { ok: false; res: Response }> {
  const { data, error } = await supabaseAdmin.from('companies').select(COMPANY_COLUMNS).eq('id', companyId).maybeSingle()
  if (error) return { ok: false, res: err('DB_ERROR', 'Erro ao consultar a empresa', 503) }
  const company = data as FoodCompany | null
  if (!company || company.deleted_at) return { ok: false, res: err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404) }
  // Empresa aberta pelo app (owner_ref nulo) nunca é do Alber Food.
  if (!company.owner_ref || company.owner_ref !== ownerRef) return { ok: false, res: err('NOT_OWNER', 'Esta empresa não pertence a este dono', 403) }
  return { ok: true, company }
}

/** Empresa aprovada no KYC, com conta ativa e chave de subconta: a única que movimenta dinheiro. */
export const isOperational = (c: Pick<FoodCompany, 'kyc_status' | 'account_status' | 'asaas_api_key_enc'>): boolean =>
  c.kyc_status === 'approved' && c.account_status !== 'blocked' && Boolean(c.asaas_api_key_enc)

export const notApproved = () => err('COMPANY_NOT_APPROVED', 'Empresa sem conta aprovada', 409)

// ── Chave Pix de saque ───────────────────────────────────────────────────────

/** Máscara mostrada ao dono: CNPJ -> 8 primeiros caracteres + ***; aleatória -> 8 primeiros + ... (igual ao company-set-pix-key do app). */
export function maskPixKey(type: 'cnpj' | 'random', clear: string): string {
  return type === 'cnpj' ? `${clear.slice(0, 8)}***` : `${clear.slice(0, 8)}...`
}

/** Chave Pix de saque em claro (decifrada com ENCRYPTION_KEY). Lança se não decifrar. */
export const decryptPixKey = (company: Pick<FoodCompany, 'pix_key'>): Promise<string> => aesDecrypt(company.pix_key as string, Deno.env.get('ENCRYPTION_KEY')!)

export interface PixKeyView {
  configured: boolean
  type: 'cnpj' | 'random' | null
  masked: string | null
  digest: string | null
  changed_at: string | null
  available_at: string | null
}

/** Quando os saques voltam depois de cadastrar uma chave aleatória ou de trocar o titular (guarda de 48 h), ou null. */
export function pixKeyAvailableAt(changedAt: string | null): string | null {
  return changedAt ? new Date(new Date(changedAt).getTime() + WITHDRAW_RULES.pixKeyWaitHours * 3_600_000).toISOString() : null
}

/**
 * Como o Alber Food enxerga a chave: tipo, máscara, digest (SHA-256 de `${company_id}|${chave}`, o que o Food assina no saque), quando foi
 * cadastrada e quando a espera termina. Nunca devolve a chave. Se a chave guardada não decifrar, devolve configured sem máscara nem digest.
 */
export async function pixKeyView(company: FoodCompany): Promise<PixKeyView> {
  const available_at = pixKeyAvailableAt(company.pix_key_changed_at)
  if (!company.pix_key || !company.pix_key_type) {
    return { configured: false, type: null, masked: null, digest: null, changed_at: null, available_at }
  }
  const changed_at = company.pix_key_set_at ?? company.pix_key_changed_at ?? null
  try {
    const clear = await decryptPixKey(company)
    return { configured: true, type: company.pix_key_type, masked: maskPixKey(company.pix_key_type, clear), digest: await destinationDigest(company.id, clear), changed_at, available_at }
  } catch {
    return { configured: true, type: company.pix_key_type, masked: null, digest: null, changed_at, available_at }
  }
}

// ── Operações assinadas ──────────────────────────────────────────────────────

export function respondStored(r: StoredResult): Response {
  return r.ok ? json(r.body, r.status) : err(r.code, r.message, r.status, r.extra)
}

/** Resposta única para qualquer falha da autorização: não diz qual verificação falhou. */
export const invalidAuthorization = () => err('INVALID_AUTHORIZATION', 'Autorização da operação inválida', 403)

/**
 * Confere a autorização assinada (verifyFoodOp), reserva o nonce e a idempotency_key (reserveFoodOp), executa `perform` UMA vez e guarda o
 * desfecho. Repetição da mesma operação devolve o desfecho guardado sem executar de novo. Quem chama já provou o dono e já leu a empresa.
 */
export async function runFoodOp(
  supabaseAdmin: SupabaseClient,
  fn: string,
  req: Request,
  rawOp: unknown,
  expected: FoodOpExpectation,
  perform: (op: FoodOp) => Promise<StoredResult>,
): Promise<Response> {
  const audit = async (event_type: string, metadata: Record<string, unknown>) => {
    try { await supabaseAdmin.from('audit_logs').insert({ user_id: null, event_type, metadata }) } catch { /* não crítico */ }
  }

  const verdict = await verifyFoodOp(req.headers, rawOp, expected)
  if (!verdict.ok) {
    if (verdict.reason === 'not_configured') return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
    // O motivo fica só no log do servidor; a resposta é sempre a mesma.
    await audit('food_op_rejected', { function: fn, kind: expected.kind, company_id: expected.companyId, owner_ref: expected.ownerRef, reason: verdict.reason })
    return invalidAuthorization()
  }
  const op = verdict.op

  const reservation = await reserveFoodOp(supabaseAdmin, op)
  switch (reservation.kind) {
    case 'replay': return respondStored(reservation.result)
    case 'in_progress': return err('OPERATION_IN_PROGRESS', 'Esta operação ainda está em andamento', 409)
    case 'conflict':
      await audit('food_op_rejected', { function: fn, kind: op.kind, company_id: op.company_id, owner_ref: op.owner_ref, reason: 'reused' })
      return invalidAuthorization()
    case 'error':
      return err('DB_ERROR', 'Erro temporário. Tente novamente.', 503)
  }

  let result: StoredResult
  try {
    result = await perform(op)
  } catch (e) {
    await logError(supabaseAdmin, fn, e, { company_id: op.company_id, kind: op.kind })
    result = { ok: false, status: 500, code: 'INTERNAL_ERROR', message: 'Erro interno ao executar a operação' }
  }
  if (!(await finishFoodOp(supabaseAdmin, reservation.id, result))) {
    await logError(supabaseAdmin, fn, new Error('food_ops_finish_failed'), { company_id: op.company_id, kind: op.kind, ok: result.ok })
  }
  return respondStored(result)
}

export const refusal = (code: string, message: string, status: number, opts: { extra?: Record<string, unknown>; retryable?: boolean; leaveOpen?: boolean } = {}): StoredResult =>
  ({ ok: false, code, message, status, ...opts })

export { sha256hex }
