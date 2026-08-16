// Spec: /specs/06_modules/alber_lounge.md § 8.6 "Cancelamento de evento"
// POST /event-cancel { event_id }
// Cancela evento, reembolsa ingressos pagos via transferência Asaas e notifica participantes.
// Reembolso best-effort: falhas individuais são logadas, restantes prosseguem.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt } from '../_shared/crypto.ts'
import { transferToWallet } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface CancelRequest {
  event_id: string
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Body ──────────────────────────────────────────────────────────────────────
  let body: CancelRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }
  if (!body.event_id) return err('MISSING_FIELDS', 'event_id é obrigatório', 400)

  // ── Buscar caller + evento em paralelo ────────────────────────────────────────
  const [userRes, eventRes] = await Promise.all([
    supabaseAdmin.from('users').select('id').eq('auth_id', authUser.id).maybeSingle(),
    supabaseAdmin.from('events').select('id, name, space_id, is_paid, status').eq('id', body.event_id).maybeSingle(),
  ])

  const caller = userRes.data
  const event  = eventRes.data

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  if (!event || event.status === 'cancelled') {
    return err('EVENT_NOT_FOUND', 'Evento não encontrado ou já cancelado', 404)
  }

  // ── Verificar permissão ────────────────────────────────────────────────────────
  const { data: membership } = await supabaseAdmin
    .from('space_members')
    .select('role, status')
    .eq('space_id', event.space_id)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!membership || membership.status !== 'active' || !['owner', 'admin'].includes(membership.role)) {
    return err('FORBIDDEN', 'Apenas donos e gestores podem cancelar eventos', 403)
  }

  // ── Buscar todos os ingressos confirmados ──────────────────────────────────────
  const { data: tickets, error: ticketsErr } = await supabaseAdmin
    .from('event_tickets')
    .select('id, user_id, price_albers, price_brl')
    .eq('event_id', body.event_id)
    .eq('status', 'confirmed')

  if (ticketsErr) {
    await logError(supabaseAdmin, 'event-cancel', ticketsErr, { event_id: body.event_id })
    return err('DB_ERROR', 'Erro ao buscar ingressos', 500)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTickets   = (tickets ?? []) as any[]
  const paidTickets  = allTickets.filter(t => Number(t.price_albers) > 0)
  const freeTickets  = allTickets.filter(t => Number(t.price_albers) === 0)
  let   refunded_count = 0

  // ── Reembolsar ingressos pagos (best-effort) ───────────────────────────────────
  if (event.is_paid && paidTickets.length > 0) {
    // Obter API key do dono do lounge para transferir de volta ao comprador
    const ownerRes = await supabaseAdmin
      .from('space_members')
      .select('user_id')
      .eq('space_id', event.space_id)
      .eq('role', 'owner')
      .eq('status', 'active')
      .maybeSingle()

    const ownerUserId = ownerRes.data?.user_id
    let   ownerApiKey: string | null = null

    if (ownerUserId) {
      const { data: ownerUser } = await supabaseAdmin
        .from('users')
        .select('asaas_api_key_enc')
        .eq('id', ownerUserId)
        .maybeSingle()

      if (ownerUser?.asaas_api_key_enc) {
        try {
          ownerApiKey = await aesDecrypt(ownerUser.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
        } catch (e) {
          await logError(supabaseAdmin, 'event-cancel', e, { event_id: body.event_id, context: 'decrypt_owner_key' })
        }
      }
    }

    for (const ticket of paidTickets) {
      try {
        const { data: buyerUser } = await supabaseAdmin
          .from('users')
          .select('asaas_wallet_id')
          .eq('id', ticket.user_id)
          .maybeSingle()

        if (!buyerUser?.asaas_wallet_id || !ownerApiKey) {
          await logError(supabaseAdmin, 'event-cancel', new Error('refund_skipped'), {
            event_id:  body.event_id,
            ticket_id: ticket.id,
            reason:    !ownerApiKey ? 'no_owner_key' : 'no_buyer_wallet',
          })
          continue
        }

        await transferToWallet(
          Number(ticket.price_albers),
          buyerUser.asaas_wallet_id,
          `Reembolso — ${event.name}`,
          `refund-${ticket.id}`,
          ownerApiKey,
        )

        await Promise.all([
          supabaseAdmin
            .from('event_tickets')
            .update({ status: 'refunded' })
            .eq('id', ticket.id),
          supabaseAdmin
            .from('transactions')
            .insert({
              user_id:    ticket.user_id,
              type:       'event_refund',
              amount:     Number(ticket.price_albers),
              amount_brl: Number(ticket.price_brl),
              fee_amount: 0,
              status:     'completed',
              metadata: {
                event_id:   body.event_id,
                event_name: event.name,
                ticket_id:  ticket.id,
              },
            }),
        ])

        await sendPush(
          ticket.user_id,
          'Evento cancelado',
          `O evento "${event.name}" foi cancelado. Seu saldo foi reembolsado.`,
          { route: '/(app)/atividade' },
          undefined,
          'lounge_event',
        )

        refunded_count++
      } catch (e) {
        await logError(supabaseAdmin, 'event-cancel', e, {
          event_id:  body.event_id,
          ticket_id: ticket.id,
          context:   'refund_loop',
        })
      }
    }
  }

  // ── Marcar tickets gratuitos e notificar ───────────────────────────────────────
  if (freeTickets.length > 0) {
    await supabaseAdmin
      .from('event_tickets')
      .update({ status: 'refunded' })
      .eq('event_id', body.event_id)
      .eq('status', 'confirmed')
      .eq('price_albers', 0)

    await Promise.all(
      freeTickets.map((t: any) =>
        sendPush(
          t.user_id,
          'Evento cancelado',
          `O evento "${event.name}" foi cancelado.`,
          { route: '/(app)/atividade' },
          undefined,
          'lounge_event',
        )
      )
    )
  }

  // ── Cancelar evento + lotes ────────────────────────────────────────────────────
  await Promise.all([
    supabaseAdmin.from('events').update({ status: 'cancelled' }).eq('id', body.event_id),
    supabaseAdmin.from('event_batches').update({ status: 'expired' }).eq('event_id', body.event_id),
  ])

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    caller.id,
    event_type: 'event_cancelled',
    metadata:   {
      event_id:       body.event_id,
      refunded_count,
      total_tickets:  allTickets.length,
    },
  })

  return json({
    cancelled:     true,
    event_id:      body.event_id,
    refunded_count,
    total_tickets: allTickets.length,
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
