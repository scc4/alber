// Spec: /specs/06_modules/alber_lounge.md § 9.2 "Comprar ingresso"
// POST /event-ticket
// Gratuito: reserva atômica → INSERT ticket.
// Pago: reserva atômica → PIN → saldo → debita Asaas → INSERT ticket.
// Race condition tratada com UPDATE WHERE (optimistic lock) antes das ops financeiras.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { bcryptVerify, aesDecrypt } from '../_shared/crypto.ts'
import { getSubcontaBalance, transferToWallet } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface TicketRequest {
  event_id:  string
  pin_hash?: string   // SHA-256(PIN) — obrigatório quando is_paid=true
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── Ativa próximo lote quando o atual esgota ──────────────────────────────────

async function tryActivateNextBatch(eventId: string, currentBatchNumber: number): Promise<void> {
  try {
    await supabaseAdmin
      .from('event_batches')
      .update({ status: 'active' })
      .eq('event_id', eventId)
      .eq('batch_number', currentBatchNumber + 1)
      .eq('status', 'pending')
  } catch (e) {
    await logError(supabaseAdmin, 'event-ticket', e, { eventId, currentBatchNumber, context: 'tryActivateNextBatch' })
  }
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ────────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Parse body ──────────────────────────────────────────────────────────────

  let body: TicketRequest
  try { body = await req.json() } catch (e) {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.event_id) return err('MISSING_FIELDS', 'event_id é obrigatório', 400)

  // ── Buscar usuário e evento em paralelo ─────────────────────────────────────

  const [userRes, eventRes] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('id, auth_id, asaas_api_key_enc, asaas_wallet_id')
      .eq('auth_id', authUser.id)
      .maybeSingle(),
    supabaseAdmin
      .from('events')
      .select('id, space_id, name, is_paid, status, visibility')
      .eq('id', body.event_id)
      .maybeSingle(),
  ])

  const user  = userRes.data
  const event = eventRes.data

  if (!user)  return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  if (!event || event.status !== 'active') {
    return err('EVENT_NOT_FOUND', 'Evento não encontrado ou inativo', 404)
  }

  // ── Verificar acesso e duplicata em paralelo ─────────────────────────────────

  const [membershipRes, duplicateRes] = await Promise.all([
    supabaseAdmin
      .from('space_members')
      .select('status')
      .eq('space_id', event.space_id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('event_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', body.event_id)
      .eq('user_id', user.id)
      .eq('status', 'confirmed'),
  ])

  if (event.visibility === 'members' && membershipRes.data?.status !== 'active') {
    return err('NOT_MEMBER', 'Acesso restrito a membros deste Lounge', 403)
  }

  if ((duplicateRes.count ?? 0) > 0) {
    return err('DUPLICATE_TICKET', 'Você já possui ingresso para este evento', 422)
  }

  // ── Buscar lote ativo ───────────────────────────────────────────────────────

  const { data: batch } = await supabaseAdmin
    .from('event_batches')
    .select('id, event_id, batch_number, price_brl, capacity, sold, status')
    .eq('event_id', body.event_id)
    .eq('status', 'active')
    .order('batch_number', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!batch) {
    return err('SOLD_OUT', 'Não há ingressos disponíveis para este evento', 422)
  }

  // ── Reserva atômica do lote ─────────────────────────────────────────────────
  // UPDATE com WHERE garante que apenas uma compra concorrente vence por vaga.
  // Para o fluxo pago, a reserva acontece ANTES das operações financeiras para
  // evitar chamar Asaas em lote já esgotado por compra simultânea.

  const { data: reservedBatch } = await supabaseAdmin
    .from('event_batches')
    .update({ sold: batch.sold + 1 })
    .eq('id', batch.id)
    .eq('sold', batch.sold)       // optimistic lock: falha se alguém comprou entre o SELECT e este UPDATE
    .lt('sold', batch.capacity)   // impede ultrapassar capacidade
    .select('id, sold, batch_number')
    .maybeSingle()

  if (!reservedBatch) {
    return err('BATCH_SOLD_OUT', 'Lote esgotado. Tente novamente.', 409)
  }

  const newSold = reservedBatch.sold

  // Reverte o sold em caso de falha após a reserva
  async function rollbackBatchSold() {
    try {
      await supabaseAdmin
        .from('event_batches')
        .update({ sold: batch.sold })
        .eq('id', batch.id)
    } catch (e) {
      await logError(supabaseAdmin, 'event-ticket', e, { batch_id: batch.id, context: 'rollbackBatchSold' })
    }
  }

  // ── Fluxo gratuito ──────────────────────────────────────────────────────────

  if (!event.is_paid) {
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from('event_tickets')
      .insert({
        event_id:     body.event_id,
        batch_id:     batch.id,
        user_id:      user.id,
        price_brl:    0,
        price_albers: 0,
        status:       'confirmed',
      })
      .select('id, purchased_at')
      .single()

    if (ticketErr || !ticket) {
      await rollbackBatchSold()
      await logError(supabaseAdmin, 'event-ticket', ticketErr ?? new Error('ticket_insert_failed'), { event_id: body.event_id })
      return err('DB_ERROR', 'Erro ao confirmar ingresso', 500)
    }

    if (newSold >= batch.capacity) {
      await supabaseAdmin.from('event_batches').update({ status: 'sold_out' }).eq('id', batch.id)
      await tryActivateNextBatch(body.event_id, batch.batch_number)
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'event_ticket_completed',
      metadata: { event_id: body.event_id, ticket_id: ticket.id, is_paid: false },
    })

    return json({
      ticket_id:    ticket.id,
      event_id:     body.event_id,
      batch_id:     batch.id,
      price_brl:    0,
      price_albers: 0,
      purchased_at: ticket.purchased_at,
    })
  }

  // ── Fluxo pago ──────────────────────────────────────────────────────────────

  if (!body.pin_hash) {
    await rollbackBatchSold()
    return err('PIN_REQUIRED', 'PIN obrigatório para ingresso pago', 400)
  }

  const priceBrl    = Number(batch.price_brl)
  const priceAlbers = priceBrl  // paridade 1:1 no MVP

  // Buscar taxa de evento configurada no painel admin (spec AS-11)
  const { data: rateRow } = await supabaseAdmin
    .from('rates')
    .select('percentage')
    .eq('type', 'event')
    .maybeSingle()
  const feeRate   = rateRow?.percentage ?? 0
  const feeAmount = parseFloat((priceBrl * feeRate).toFixed(2))

  // Verificar PIN
  const { data: authMeta } = await supabaseAdmin.auth.admin.getUserById(user.auth_id)
  const pinBcrypt: string | undefined = authMeta?.user?.app_metadata?.pin_bcrypt

  if (!pinBcrypt) {
    await rollbackBatchSold()
    return err('INVALID_CREDENTIALS', 'PIN não configurado', 401)
  }

  const pinOk = await bcryptVerify(body.pin_hash, pinBcrypt)
  if (!pinOk) {
    await rollbackBatchSold()
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'event_ticket_pin_failed',
      metadata: { event_id: body.event_id },
    })
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
  }

  // Verificar configuração Asaas
  if (!user.asaas_api_key_enc) {
    await rollbackBatchSold()
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta financeira não configurada', 503)
  }

  let userApiKey: string
  try {
    userApiKey = await aesDecrypt(user.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
  } catch (e) {
    await rollbackBatchSold()
    await logError(supabaseAdmin, 'event-ticket', e, { event_id: body.event_id })
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // Verificar saldo e buscar wallet do dono do Lounge em paralelo
  let balance: number
  let ownerWalletId: string
  let ownerId: string

  try {
    const [bal, spaceRes] = await Promise.all([
      getSubcontaBalance(userApiKey),
      supabaseAdmin.from('spaces').select('owner_id').eq('id', event.space_id).maybeSingle(),
    ])
    balance = bal
    if (!spaceRes.data?.owner_id) {
      await rollbackBatchSold()
      return err('OWNER_NOT_FOUND', 'Organizador do evento não encontrado', 404)
    }
    ownerId = spaceRes.data.owner_id
  } catch (e) {
    await rollbackBatchSold()
    await logError(supabaseAdmin, 'event-ticket', e, { event_id: body.event_id })
    return err('ASAAS_ERROR', 'Não foi possível verificar saldo', 503)
  }

  const { data: ownerUser } = await supabaseAdmin
    .from('users')
    .select('asaas_wallet_id')
    .eq('id', ownerId)
    .maybeSingle()

  if (!ownerUser?.asaas_wallet_id) {
    await rollbackBatchSold()
    return err('OWNER_NOT_CONFIGURED', 'A conta do organizador não está configurada para receber pagamentos.', 503)
  }
  ownerWalletId = ownerUser.asaas_wallet_id

  if (balance < priceAlbers) {
    await rollbackBatchSold()
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'event_ticket_insufficient',
      metadata: { event_id: body.event_id, balance, required: priceAlbers },
    })
    return err('INSUFFICIENT_BALANCE', 'Saldo insuficiente', 422)
  }

  // Valor líquido que vai ao dono do Lounge (preço total − taxa da plataforma)
  const netAmount = feeAmount > 0
    ? Math.max(0, parseFloat((priceAlbers - feeAmount).toFixed(2)))
    : priceAlbers

  // Inserir transação pending
  const { data: txData, error: txErr } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:    user.id,
      type:       'event_purchase',
      amount:     priceAlbers,
      amount_brl: priceBrl,
      fee_amount: feeAmount,
      status:     'pending',
      metadata:   {
        event_id:        body.event_id,
        event_name:      event.name,
        owner_wallet_id: ownerWalletId,
        net_amount:      netAmount,
      },
    })
    .select('id')
    .single()

  if (txErr || !txData) {
    await rollbackBatchSold()
    await logError(supabaseAdmin, 'event-ticket', txErr ?? new Error('tx_insert_failed'), { event_id: body.event_id })
    return err('DB_ERROR', 'Erro ao registrar transação', 500)
  }

  // ── Transferência 1: valor líquido → dono do Lounge (crítica) ────────────────
  try {
    await transferToWallet(
      netAmount,
      ownerWalletId,
      `Ingresso — ${event.name}`,
      txData.id,
      userApiKey,
    )
  } catch (e) {
    await rollbackBatchSold()
    await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', txData.id)
    await logError(supabaseAdmin, 'event-ticket', e, { event_id: body.event_id, tx_id: txData.id })
    return err('ASAAS_ERROR', 'Falha ao processar pagamento. Tente novamente.', 503)
  }

  // ── Transferência 2: taxa → conta pai da plataforma (não crítica) ─────────────
  // Dono já recebeu. Se a taxa falhar, é reconciliada manualmente via audit_log.
  if (feeAmount > 0) {
    try {
      await transferToWallet(
        feeAmount,
        Deno.env.get('ASAAS_PARENT_WALLET_ID')!,
        `Taxa ingresso — ${event.name}`,
        `${txData.id}-fee`,
        userApiKey,
      )
    } catch (e) {
      await logError(supabaseAdmin, 'event-ticket', e, {
        event_id: body.event_id, tx_id: txData.id, context: 'fee_transfer',
      })
    }
  }

  await supabaseAdmin.from('transactions').update({ status: 'completed' }).eq('id', txData.id)

  // Inserir ingresso
  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from('event_tickets')
    .insert({
      event_id:     body.event_id,
      batch_id:     batch.id,
      user_id:      user.id,
      price_brl:    priceBrl,
      price_albers: priceAlbers,
      status:       'confirmed',
    })
    .select('id, purchased_at')
    .single()

  if (ticketErr || !ticket) {
    await logError(supabaseAdmin, 'event-ticket', ticketErr ?? new Error('ticket_insert_failed'), { event_id: body.event_id })
    return err('DB_ERROR', 'Ingresso pago mas erro ao registrar. Entre em contato com o suporte.', 500)
  }

  // Atualizar status do lote e ativar próximo se necessário
  if (newSold >= batch.capacity) {
    await supabaseAdmin.from('event_batches').update({ status: 'sold_out' }).eq('id', batch.id)
    await tryActivateNextBatch(body.event_id, batch.batch_number)
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'event_batch_sold_out',
      metadata: { event_id: body.event_id, batch_id: batch.id, batch_number: batch.batch_number },
    })
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id: user.id, event_type: 'event_ticket_completed',
    metadata: { event_id: body.event_id, ticket_id: ticket.id, price_albers: priceAlbers, tx_id: txData.id },
  })

  await sendPush(
    user.id,
    'Ingresso confirmado!',
    `Seu ingresso para o evento foi confirmado.`,
    { route: `/(app)/lounge/evento/${body.event_id}` },
    undefined,
    'lounge_event',
  )

  return json({
    ticket_id:    ticket.id,
    event_id:     body.event_id,
    batch_id:     batch.id,
    price_brl:    priceBrl,
    price_albers: priceAlbers,
    purchased_at: ticket.purchased_at,
  })
})
