// Spec: /specs/06_modules/alber_lounge.md § 8.4 "Lista de confirmados"
// POST /event-tickets-list { event_id }
// Retorna lista de ingressos confirmados (owner/manager apenas)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface TicketsListRequest {
  event_id: string
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ───────────────────────────────────────────────────────────────────────
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

  // ── Body ───────────────────────────────────────────────────────────────────────
  let body: TicketsListRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }
  if (!body.event_id) return err('MISSING_FIELDS', 'event_id é obrigatório', 400)

  // ── Buscar usuário + evento em paralelo ────────────────────────────────────────
  const [userRes, eventRes] = await Promise.all([
    supabaseAdmin.from('users').select('id').eq('auth_id', authUser.id).maybeSingle(),
    supabaseAdmin.from('events').select('id, name, space_id, status, is_paid').eq('id', body.event_id).maybeSingle(),
  ])

  const user  = userRes.data
  const event = eventRes.data
  if (!user)  return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  if (!event) return err('EVENT_NOT_FOUND', 'Evento não encontrado', 404)

  // ── Verificar permissão: owner ou manager do lounge ───────────────────────────
  const { data: membership } = await supabaseAdmin
    .from('space_members')
    .select('role, status')
    .eq('space_id', event.space_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || membership.status !== 'active' || !['owner', 'admin'].includes(membership.role)) {
    return err('FORBIDDEN', 'Apenas donos e gestores podem ver a lista de confirmados', 403)
  }

  // ── Buscar ingressos confirmados ──────────────────────────────────────────────
  const { data: tickets, error: ticketsErr } = await supabaseAdmin
    .from('event_tickets')
    .select(`
      id,
      price_brl,
      price_albers,
      status,
      purchased_at,
      batch_id,
      user_id,
      batch:event_batches(id, batch_number),
      buyer:users!event_tickets_user_id_fkey(id, name, handle)
    `)
    .eq('event_id', body.event_id)
    .eq('status', 'confirmed')
    .order('purchased_at', { ascending: true })

  if (ticketsErr) {
    await logError(supabaseAdmin, 'event-tickets-list', ticketsErr, { event_id: body.event_id })
    return err('DB_ERROR', 'Erro ao buscar ingressos', 500)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (tickets ?? []).map((t: any) => ({
    ticket_id:    t.id,
    user_name:    t.buyer?.name ?? '',
    user_handle:  t.buyer?.handle ? `@${t.buyer.handle}` : '',
    batch_name:   t.batch ? `${t.batch.batch_number}º Lote` : '—',
    price_brl:    Number(t.price_brl),
    price_albers: Number(t.price_albers),
    purchased_at: t.purchased_at,
  }))

  const total_brl = list.reduce((s, t) => s + t.price_brl, 0)

  return json({
    event_id:   body.event_id,
    event_name: event.name,
    tickets:    list,
    total:      list.length,
    total_brl,
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
