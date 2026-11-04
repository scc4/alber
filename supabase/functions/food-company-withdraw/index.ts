// POST /food-company-withdraw   (Alber Food -> Alber; x-alber-food-key + autorização assinada; sem JWT de usuário)
//   { company_id, owner_ref, amount_cents, op }
//   -> { transaction_id, status: 'completed'|'processing', amount_cents, destination_masked }
//
// A ÚNICA saída de dinheiro da empresa do Alber Food: Pix de saque para a chave cadastrada (food-company-set-pix-key). Não existe carregar,
// transferir nem receber para essas empresas.
// Ordem: dono -> empresa aprovada -> chave cadastrada -> autorização assinada (assinatura, validade, nonce, valor e destino iguais ao que o
// Alber guarda) -> reserva do nonce/idempotency_key -> guarda de saque (vínculo, carência de 48 h da chave aleatória, limites inclusive o
// aprovado) -> saldo na subconta -> lançamento pendente -> nova leitura da guarda (fecha a corrida entre dois saques ao mesmo tempo) ->
// Pix no Asaas. O lançamento nasce com company_id, actor_ref = owner_ref e user_id nulo (type 'descarregar': entra na soma do limite diário e
// o webhook TRANSFER_DONE/FAILED do Asaas leva 'processing' a 'completed'/'failed').
// Repetir a MESMA operação (idempotency_key) devolve o desfecho original, sem novo débito. Sem taxa: ver FOOD_WITHDRAW_FEE_ENABLED.

import { handleCors, err } from '../_shared/cors.ts'
import { cashoutPix, getSubcontaBalance, transferToWallet, AsaasError } from '../_shared/asaas.ts'
import { decryptSubaccountKey } from '../_shared/subaccount-key.ts'
import { checkCompanyWithdrawal, LIMIT_REQUEST_CAPS } from '../_shared/withdraw-guard.ts'
import { logError } from '../_shared/error-log.ts'
import {
  adminClient, decryptPixKey, destinationDigest, foodWithdrawFeeBrl, isInt, isObject, isOperational, loadOwnedCompany, maskPixKey, readIds,
  readServiceBody, refusal, runFoodOp,
} from '../_shared/food-company.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** Mínimo de um saque (R$ 10, o mesmo de financial-descarregar) e teto de segurança (o maior limite que a equipe pode aprovar). */
export const MIN_WITHDRAW_CENTS = 1_000
export const MAX_WITHDRAW_CENTS = LIMIT_REQUEST_CAPS.perTxBrl * 100

export interface WithdrawDeps {
  /** Taxa em reais (padrão: foodWithdrawFeeBrl, hoje sempre 0). Injetável nos testes. */
  feeBrl?: (supabaseAdmin: SupabaseClient, amountBrl: number) => Promise<number>
}

export async function handleRequest(req: Request, deps: WithdrawDeps = {}): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const { body } = parsed
  const ids = readIds(body)
  if (!ids.ok) return ids.res
  const amountCents = body.amount_cents
  if (!isInt(amountCents) || amountCents < MIN_WITHDRAW_CENTS || amountCents > MAX_WITHDRAW_CENTS) {
    return err('INVALID_AMOUNT', `amount_cents deve ser inteiro entre ${MIN_WITHDRAW_CENTS} e ${MAX_WITHDRAW_CENTS}`, 422)
  }
  if (!isObject(body.op)) return err('MISSING_FIELDS', 'op é obrigatório', 400)
  if (!Deno.env.get('ALBER_KEYS_ENCRYPTION_KEY') && !Deno.env.get('ASAAS_API_KEY')) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
  if (!loaded.ok) return loaded.res
  const company = loaded.company
  if (!company.pix_key || !company.pix_key_type) return err('COMPANY_PIX_KEY_NOT_CONFIGURED', 'Chave Pix da empresa ainda não configurada', 422)

  let pixKey: string
  try {
    pixKey = await decryptPixKey(company)
  } catch (e) {
    await logError(supabaseAdmin, 'food-company-withdraw', e, { company_id: company.id })
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }
  const pixKeyType = company.pix_key_type
  const destinationMasked = maskPixKey(pixKeyType, pixKey)
  const amountBrl = amountCents / 100

  return await runFoodOp(
    supabaseAdmin, 'food-company-withdraw', req, body.op,
    { kind: 'withdraw', companyId: company.id, ownerRef: ids.ownerRef, amountCents, destinationDigest: await destinationDigest(company.id, pixKey) },
    async (op) => {
      // Estado da empresa conferido DEPOIS da autorização e da reserva: repetir um saque já concluído devolve o desfecho original mesmo que a
      // empresa tenha sido bloqueada no meio tempo (idempotência).
      if (!isOperational(company)) return refusal('COMPANY_NOT_APPROVED', 'Empresa sem conta aprovada', 409)

      const blocked = async (code: string, extra: Record<string, unknown>) => {
        await supabaseAdmin.from('audit_logs').insert({
          user_id: null, event_type: 'company_withdraw_blocked',
          metadata: { company_id: company.id, code, amount: amountBrl, via: 'food', owner_ref: op.owner_ref, ...extra },
        }).then(() => {}, () => {})
      }

      // 1) Guarda de saque: vínculo, carência da chave, limites.
      const guard = await checkCompanyWithdrawal(supabaseAdmin, company.id, amountBrl)
      if (!guard.ok) {
        await blocked(guard.code, {})
        return refusal(guard.code, guard.message, guard.status, { extra: guard.extra, retryable: guard.code === 'WITHDRAW_CHECK_FAILED' })
      }

      // 2) Saldo da subconta.
      let subApiKey: string
      try {
        subApiKey = await decryptSubaccountKey(company.asaas_api_key_enc as string)
      } catch (e) {
        await logError(supabaseAdmin, 'food-company-withdraw', e, { company_id: company.id })
        return refusal('CRYPTO_ERROR', 'Erro interno de segurança', 500, { retryable: true })
      }
      let balance: number
      try {
        balance = await getSubcontaBalance(subApiKey)
      } catch (e) {
        await logError(supabaseAdmin, 'food-company-withdraw', e, { company_id: company.id })
        return refusal('ASAAS_ERROR', 'Não foi possível verificar o saldo. Tente novamente.', 503, { retryable: true })
      }
      if (balance < amountBrl) return refusal('INSUFFICIENT_BALANCE', 'Saldo insuficiente', 422)

      // 3) Taxa (hoje 0) e lançamento pendente. user_id nulo + actor_ref = owner_ref (constraint transactions_actor_present_check).
      const feeBrl = await (deps.feeBrl ?? foodWithdrawFeeBrl)(supabaseAdmin, amountBrl)
      const netBrl = parseFloat((amountBrl - feeBrl).toFixed(2))
      const { data: tx, error: txErr } = await supabaseAdmin
        .from('transactions')
        .insert({
          user_id: null,
          actor_ref: op.owner_ref,
          company_id: company.id,
          type: 'descarregar',
          amount: amountBrl,
          amount_brl: amountBrl,
          fee_amount: feeBrl,
          status: 'pending',
          metadata: { via: 'food', pix_key_type: pixKeyType, destination_masked: destinationMasked, net_brl: netBrl, idempotency_key: op.idempotency_key },
        })
        .select('id')
        .single()
      if (txErr || !tx) {
        await logError(supabaseAdmin, 'food-company-withdraw', txErr ?? new Error('tx_insert_failed'), { company_id: company.id })
        return refusal('DB_ERROR', 'Erro ao registrar transação', 500, { retryable: true })
      }
      const transactionId = (tx as { id: string }).id

      let feeTxId: string | undefined
      if (feeBrl > 0) {
        const { data: feeTx } = await supabaseAdmin
          .from('transactions')
          .insert({
            user_id: null, actor_ref: op.owner_ref, company_id: company.id, type: 'fee', amount: feeBrl, amount_brl: feeBrl, fee_amount: 0,
            status: 'pending', reference_id: transactionId, reference_type: 'descarregar', metadata: { source: 'food_withdraw' },
          })
          .select('id')
          .single()
        feeTxId = (feeTx as { id: string } | null)?.id
      }
      const failBoth = async () => {
        await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', transactionId)
        if (feeTxId) await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', feeTxId)
      }

      // 4) Corrida: a soma do dia já inclui ESTE lançamento; se dois saques passaram juntos pela guarda, o que estourar o limite recua aqui.
      const recheck = await checkCompanyWithdrawal(supabaseAdmin, company.id, 0)
      if (!recheck.ok) {
        await failBoth()
        await blocked(recheck.code, { transaction_id: transactionId, phase: 'recheck' })
        return refusal(recheck.code, recheck.message, recheck.status, { extra: recheck.extra, retryable: recheck.code === 'WITHDRAW_CHECK_FAILED' })
      }

      // 5) Pix no Asaas. 'random' é EVP para o Asaas.
      const asaasPixType = pixKeyType === 'random' ? 'EVP' : pixKeyType.toUpperCase()
      let transfer: { id: string; status: string }
      try {
        transfer = await cashoutPix(netBrl, pixKey, asaasPixType, transactionId, subApiKey)
      } catch (e) {
        if (e instanceof AsaasError) {
          // O Asaas recusou: o dinheiro não saiu.
          await logError(supabaseAdmin, 'food-company-withdraw', e, { company_id: company.id, transaction_id: transactionId }, { asaas_response: e.asaasResponse })
          await failBoth()
          return refusal('ASAAS_ERROR', 'Falha ao processar a transferência Pix. Tente novamente.', 503)
        }
        // Sem resposta (rede, tempo esgotado): o Pix pode ter sido criado. NÃO fecha como falha nem libera a chave: o lançamento fica pendente
        // (com o id dele como referência externa no Asaas) e a operação em andamento, para a equipe reconciliar.
        await logError(supabaseAdmin, 'food-company-withdraw', e, { company_id: company.id, transaction_id: transactionId, outcome: 'unknown' })
        return refusal('ASAAS_ERROR', 'Não foi possível confirmar a transferência Pix. Não repita; a equipe vai conferir.', 503, { leaveOpen: true })
      }

      // 6) Taxa para a conta pai (só se houver taxa; falha aqui não é crítica: o saldo da taxa fica na subconta e é reconciliado).
      const parentWalletId = Deno.env.get('ASAAS_PARENT_WALLET_ID')
      if (feeBrl > 0 && parentWalletId) {
        try {
          await transferToWallet(feeBrl, parentWalletId, 'Taxa saque Alber Food', crypto.randomUUID(), subApiKey)
        } catch (e) {
          await logError(supabaseAdmin, 'food-company-withdraw', e, { company_id: company.id, transaction_id: transactionId, fee: feeBrl }, { asaas_response: e instanceof AsaasError ? e.asaasResponse : null })
        }
      }

      // 7) 'processing' até o webhook TRANSFER_DONE/FAILED; a taxa já saiu da subconta.
      const { error: upErr } = await supabaseAdmin.from('transactions').update({ status: 'processing', asaas_payment_id: transfer.id }).eq('id', transactionId)
      if (upErr) await logError(supabaseAdmin, 'food-company-withdraw', upErr, { company_id: company.id, transaction_id: transactionId, asaas_transfer_id: transfer.id })
      if (feeTxId) await supabaseAdmin.from('transactions').update({ status: 'completed' }).eq('id', feeTxId)

      await supabaseAdmin.from('audit_logs').insert({
        user_id: null,
        event_type: 'descarregar_initiated',
        metadata: { transaction_id: transactionId, amount_brl: amountBrl, fee: feeBrl, net_brl: netBrl, company_id: company.id, via: 'food', owner_ref: op.owner_ref, destination_masked: destinationMasked },
      }).then(() => {}, () => {})

      return { ok: true, status: 200, body: { transaction_id: transactionId, status: 'processing', amount_cents: amountCents, destination_masked: destinationMasked } }
    },
  )
}

if (import.meta.main) {
  Deno.serve((req) => handleRequest(req))
}
