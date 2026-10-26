// Spec: /specs/03_backend.md §6 (webhook HMAC validation)
// Spec: /specs/04_api_asaas.md §4.3 (PAYMENT_CONFIRMED), §5.4 (CPF validation)
// Spec: /specs/04_api_asaas.md §4.6 (refund on CPF mismatch)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256hex, aesDecrypt } from '../_shared/crypto.ts'
import { normalizeCpf } from '../_shared/cpf.ts'
import { refundPayment } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

const HANDLED_EVENTS  = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
const TRANSFER_EVENTS = new Set(['TRANSFER_DONE', 'TRANSFER_FAILED'])

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Validar token do webhook (spec 03_backend §6) ────────────────────────────
  // Asaas envia o authToken configurado no header 'asaas-access-token'.
  // Comparação direta (token é suficientemente longo e canal é TLS).

  const receivedToken = req.headers.get('asaas-access-token')
  const expectedToken = Deno.env.get('ASAAS_WEBHOOK_SECRET')!

  if (!receivedToken || receivedToken !== expectedToken) {
    console.warn('Webhook: token inválido')
    return new Response('Unauthorized', { status: 401 })
  }

  // ── Parse do payload ─────────────────────────────────────────────────────────

  let payload: {
    event: string
    payment?: {
      id: string
      status: string
      value: number
      externalReference?: string
      pixQrCodeId?: string          // presente em pagamentos via QR Code estático
      pixTransaction?: {
        payer?: {
          cpfCnpj?: string
        }
      }
    }
    transfer?: {
      id: string
      status: string
      value: number
    }
  }

  try {
    payload = await req.json()
  } catch (e) {
    await logError(supabaseAdmin, 'webhooks-asaas-pix', e, {})
    return new Response('Bad Request', { status: 400 })
  }

  const { event, transfer } = payload

  // ── TRANSFER_DONE / TRANSFER_FAILED — conclusão do Descarregar ───────────────
  // Descarregar fica 'processing' até este webhook confirmar (ou falhar) o Pix
  // de saída. Não há saldo local a estornar: o saldo em Albers é lido ao vivo
  // da subconta Asaas (ver financial-descarregar), então uma falha de transfer
  // já é refletida automaticamente assim que o Asaas devolve o valor.

  if (transfer && TRANSFER_EVENTS.has(event)) {
    const { data: tx, error: transferTxErr } = await supabaseAdmin
      .from('transactions')
      .select('id, user_id, status, amount')
      .eq('asaas_payment_id', transfer.id)
      .maybeSingle()

    if (transferTxErr || !tx || tx.status !== 'processing') {
      // Idempotência / evento não pertence a uma transação nossa em andamento.
      return new Response('OK', { status: 200 })
    }

    const newStatus = event === 'TRANSFER_DONE' ? 'completed' : 'failed'

    await supabaseAdmin.from('transactions').update({ status: newStatus }).eq('id', tx.id)

    await supabaseAdmin.from('audit_logs').insert({
      user_id:    tx.user_id,
      event_type: `descarregar_${newStatus}`,
      metadata:   { transaction_id: tx.id, asaas_transfer_id: transfer.id, value: transfer.value },
    })

    await sendPush(
      tx.user_id,
      newStatus === 'completed' ? 'Pix enviado com sucesso!' : 'Falha no envio do Pix',
      newStatus === 'completed'
        ? `${Number(tx.amount ?? 0)} Albers foram enviados via Pix.`
        : 'Não foi possível concluir o envio do seu Pix. Tente novamente.',
      { route: '/(app)/atividade' },
      'transaction',
      'tx_descarregar',
    )

    return new Response('OK', { status: 200 })
  }

  const { payment } = payload
  if (!payment) return new Response('OK', { status: 200 })

  // ── PAYMENT_REFUNDED — atualizar status ──────────────────────────────────────
  // Para QR estático, pixQrCodeId identifica a transação; para dinâmico, payment.id.

  if (event === 'PAYMENT_REFUNDED') {
    const refundLookupId = payment.pixQrCodeId ?? payment.id
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'refunded' })
      .eq('asaas_payment_id', refundLookupId)
      .neq('status', 'refunded') // idempotência

    return new Response('OK', { status: 200 })
  }

  // ── Ignorar eventos não tratados ─────────────────────────────────────────────

  if (!HANDLED_EVENTS.has(event)) {
    return new Response('OK', { status: 200 })
  }

  // ── Localizar transação pelo asaas_payment_id ────────────────────────────────
  // QR estático: pixQrCodeId é o ID do QR (chave em asaas_payment_id).
  // QR dinâmico (legado): usa payment.id diretamente.

  const txLookupId = payment.pixQrCodeId ?? payment.id

  const { data: tx, error: txErr } = await supabaseAdmin
    .from('transactions')
    .select('id, user_id, company_id, status, amount, amount_brl')
    .eq('asaas_payment_id', txLookupId)
    .maybeSingle()

  if (txErr || !tx) {
    // Pode ocorrer em webhooks de teste ou pagamentos externos — não é erro crítico
    console.warn('Webhook: transação não encontrada para lookup_id', txLookupId)
    return new Response('OK', { status: 200 })
  }

  // ── Idempotência — já processado ─────────────────────────────────────────────

  if (tx.status === 'completed') {
    return new Response('OK', { status: 200 })
  }

  // ── Buscar dados do titular da subconta (CPF/CNPJ hash + API key) ────────────
  // Transação de empresa (tx.company_id) → titular é a empresa (CNPJ);
  // transação pessoal → titular é o usuário autor da transação (CPF).

  const isCompanyTx = Boolean(tx.company_id)

  const { data: ownerData, error: ownerErr } = isCompanyTx
    ? await supabaseAdmin
        .from('companies')
        .select('id, cnpj, asaas_api_key_enc')
        .eq('id', tx.company_id)
        .maybeSingle()
        .then(res => ({ data: res.data ? { id: res.data.id, doc: res.data.cnpj, asaas_api_key_enc: res.data.asaas_api_key_enc } : null, error: res.error }))
    : await supabaseAdmin
        .from('users')
        .select('id, cpf, asaas_api_key_enc')
        .eq('id', tx.user_id)
        .maybeSingle()
        .then(res => ({ data: res.data ? { id: res.data.id, doc: res.data.cpf, asaas_api_key_enc: res.data.asaas_api_key_enc } : null, error: res.error }))

  if (ownerErr || !ownerData) {
    console.error('Webhook: titular da subconta não encontrado para tx', tx.id)
    return new Response('OK', { status: 200 })
  }

  // ── Validar CPF/CNPJ do pagador (spec 04_api §4.3, §5.4) ────────────────────
  // cpfCnpj vem do campo pixTransaction.payer do webhook.
  // ⚠️ Disponibilidade confirmada pendente com Asaas (spec §9).
  // Se o campo não estiver presente, assume-se válido (não bloqueia o fluxo).

  const payerCpfRaw = payment.pixTransaction?.payer?.cpfCnpj

  if (payerCpfRaw) {
    const payerCpfHash = await sha256hex(normalizeCpf(payerCpfRaw))

    if (payerCpfHash !== ownerData.doc) {
      // CPF/CNPJ do pagador difere do titular da conta — devolver automaticamente
      console.warn('Webhook: CPF/CNPJ divergente para tx', tx.id)

      try {
        const encSecret = Deno.env.get('ASAAS_API_KEY')!
        const subApiKey = await aesDecrypt(ownerData.asaas_api_key_enc, encSecret)
        await refundPayment(payment.id, payment.value, 'CPF/CNPJ do pagador divergente', subApiKey)
      } catch (e) {
        console.error('Webhook: falha ao solicitar devolução:', e)
        await logError(supabaseAdmin, 'webhooks-asaas-pix', e, { event, payment_id: payment.id, transaction_id: tx.id })
      }

      await supabaseAdmin
        .from('transactions')
        .update({ status: 'failed', metadata: { reason: 'cpf_mismatch' } })
        .eq('id', tx.id)

      await supabaseAdmin.from('audit_logs').insert({
        user_id:    tx.user_id,
        event_type: 'carregar_cpf_mismatch',
        metadata:   { transaction_id: tx.id, asaas_payment_id: payment.id },
      })

      return new Response('OK', { status: 200 })
    }
  }

  // ── Confirmar carregamento — marcar completed ─────────────────────────────────

  const { error: updateErr } = await supabaseAdmin
    .from('transactions')
    .update({ status: 'completed' })
    .eq('id', tx.id)

  if (updateErr) {
    console.error('Webhook: falha ao atualizar transação:', updateErr)
    await logError(supabaseAdmin, 'webhooks-asaas-pix', updateErr, { event, payment_id: payment.id, transaction_id: tx.id })
    return new Response('Internal Server Error', { status: 500 })
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    tx.user_id,
    event_type: 'carregar_completed',
    metadata:   { transaction_id: tx.id, asaas_payment_id: payment.id, value: payment.value },
  })

  const amountAlbers = Number(tx.amount ?? 0)
  await sendPush(
    tx.user_id,
    'Albers carregados!',
    `Seus ${amountAlbers} Albers foram carregados com sucesso.`,
    { route: '/(app)/atividade' },
    'transaction',
    'tx_carregar',
  )

  return new Response('OK', { status: 200 })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
