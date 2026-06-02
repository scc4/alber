// Spec: /specs/06_modules/alber_lounge.md § 9.2 "Comprar ingresso"
// POST /event-ticket
// Gratuito: INSERT direto. Pago: verifica PIN + saldo Asaas → debita → INSERT.
// Ao esgotar lote: ativa próximo automaticamente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { bcryptVerify, aesDecrypt } from '../_shared/crypto.ts'
import { getSubcontaBalance, transferToWallet } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

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
  await supabaseAdmin
    .from('event_batches')
    .update({ status: 'active' })
    .eq('event_id', eventId)
    .eq('batch_number', currentBatchNumber + 1)
    .eq('status', 'pending')
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

  // ── Buscar usuário ──────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, auth_id, asaas_api_key_enc, asaas_wallet_id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Buscar evento ───────────────────────────────────────────────────────────

  const { data: event } = await supabaseAdmin
    .from('events')
    .select('id, space_id, name, is_paid, status, visibility')
    .eq('id', body.event_id)
    .maybeSingle()

  if (!event || event.status !== 'active') {
    return err('EVENT_NOT_FOUND', 'Evento não encontrado ou inativo', 404)
  }

  // Verificar acesso: membro ativo do space (para eventos 'members') ou qualquer usuário (para 'public')
  if (event.visibility === 'members') {
    const { data: membership } = await supabaseAdmin
      .from('space_members')
      .select('status')
      .eq('space_id', event.space_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (membership?.status !== 'active') {
      return err('NOT_MEMBER', 'Acesso restrito a membros deste Lounge', 403)
    }
  }

  // ── Verificar duplicata ─────────────────────────────────────────────────────

  const { count: alreadyHas } = await supabaseAdmin
    .from('event_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', body.event_id)
    .eq('user_id', user.id)
    .eq('status', 'confirmed')

  if ((alreadyHas ?? 0) > 0) {
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
      await logError(supabaseAdmin, 'event-ticket', ticketErr ?? new Error('ticket_insert_failed'), { event_id: body.event_id })
      return err('DB_ERROR', 'Erro ao confirmar ingresso', 500)
    }

    // Atualizar sold do lote
    const newSold = batch.sold + 1
    await supabaseAdmin
      .from('event_batches')
      .update({ sold: newSold, status: newSold >= batch.capacity ? 'sold_out' : 'active' })
      .eq('id', batch.id)

    if (newSold >= batch.capacity) {
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

  if (!body.pin_hash) return err('PIN_REQUIRED', 'PIN obrigatório para ingresso pago', 400)

  const priceBrl    = Number(batch.price_brl)
  const priceAlbers = priceBrl  // paridade 1:1 no MVP

  // Verificar PIN
  const { data: authMeta } = await supabaseAdmin.auth.admin.getUserById(user.auth_id)
  const pinBcrypt: string | undefined = authMeta?.user?.app_metadata?.pin_bcrypt

  if (!pinBcrypt) return err('INVALID_CREDENTIALS', 'PIN não configurado', 401)

  const pinOk = await bcryptVerify(body.pin_hash, pinBcrypt)
  if (!pinOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'event_ticket_pin_failed',
      metadata: { event_id: body.event_id },
    })
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
  }

  // Verificar configuração Asaas
  if (!user.asaas_api_key_enc) {
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta financeira não configurada', 503)
  }

  let userApiKey: string
  try {
    userApiKey = await aesDecrypt(user.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
  } catch (e) {
    await logError(supabaseAdmin, 'event-ticket', e, { event_id: body.event_id })
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // Verificar saldo
  let balance: number
  try {
    balance = await getSubcontaBalance(userApiKey)
  } catch (e) {
    await logError(supabaseAdmin, 'event-ticket', e, { event_id: body.event_id })
    return err('ASAAS_ERROR', 'Não foi possível verificar saldo', 503)
  }

  if (balance < priceAlbers) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'event_ticket_insufficient',
      metadata: { event_id: body.event_id, balance, required: priceAlbers },
    })
    return err('INSUFFICIENT_BALANCE', 'Saldo insuficiente', 422)
  }

  // Inserir transação pending
  const { data: txData, error: txErr } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:    user.id,
      type:       'event_ticket',
      amount:     priceAlbers,
      amount_brl: priceBrl,
      fee_amount: 0,
      status:     'pending',
      metadata:   { event_id: body.event_id, event_name: event.name },
    })
    .select('id')
    .single()

  if (txErr || !txData) {
    await logError(supabaseAdmin, 'event-ticket', txErr ?? new Error('tx_insert_failed'), { event_id: body.event_id })
    return err('DB_ERROR', 'Erro ao registrar transação', 500)
  }

  // Transferir para conta pai (ou conta do Space se configurada)
  const targetWallet = Deno.env.get('ASAAS_PARENT_WALLET_ID')!
  try {
    await transferToWallet(
      priceAlbers,
      targetWallet,
      `Ingresso — ${event.name}`,
      txData.id,
      userApiKey,
    )
  } catch (e) {
    await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', txData.id)
    await logError(supabaseAdmin, 'event-ticket', e, { event_id: body.event_id, tx_id: txData.id })
    return err('ASAAS_ERROR', 'Falha ao processar pagamento. Tente novamente.', 503)
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

  // Atualizar sold + ativar próximo lote se necessário
  const newSold = batch.sold + 1
  await supabaseAdmin
    .from('event_batches')
    .update({ sold: newSold, status: newSold >= batch.capacity ? 'sold_out' : 'active' })
    .eq('id', batch.id)

  if (newSold >= batch.capacity) {
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

  return json({
    ticket_id:    ticket.id,
    event_id:     body.event_id,
    batch_id:     batch.id,
    price_brl:    priceBrl,
    price_albers: priceAlbers,
    purchased_at: ticket.purchased_at,
  })
})
