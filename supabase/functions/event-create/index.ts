// Spec: /specs/06_modules/alber_lounge.md § 9.1 "Criar evento"
// POST /event-create
// Dono ou admin cria evento com lotes. Primeiro lote sempre ativo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface BatchInput {
  batch_type:   'quantity' | 'date'
  price_brl:    number
  capacity:     number
  valid_until?: string | null
}

interface EventCreateRequest {
  space_id:        string
  name:            string
  description?:    string
  date:            string               // ISO 8601
  visibility:      'members' | 'public'
  is_paid:         boolean
  is_recurring?:   boolean
  recurrence_freq?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | null
  batches?:        BatchInput[]         // obrigatório quando is_paid=true
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

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

  let body: EventCreateRequest
  try { body = await req.json() } catch (e) {
    await logError(supabaseAdmin, 'event-create', e, {})
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { space_id, name, description, date, visibility, is_paid, is_recurring, recurrence_freq, batches } = body

  if (!space_id || !name?.trim() || !date || !visibility) {
    return err('MISSING_FIELDS', 'space_id, name, date e visibility são obrigatórios', 400)
  }
  if (!['members', 'public'].includes(visibility)) {
    return err('INVALID_VISIBILITY', "visibility deve ser 'members' ou 'public'", 400)
  }
  if (is_paid && (!batches || batches.length === 0)) {
    return err('MISSING_BATCHES', 'Evento pago requer pelo menos 1 lote', 400)
  }

  // Validar data
  const eventDate = new Date(date)
  if (isNaN(eventDate.getTime())) {
    return err('INVALID_DATE', 'Data inválida', 400)
  }

  // Validar lotes pagos
  if (is_paid && batches) {
    for (const b of batches) {
      if (!['quantity', 'date'].includes(b.batch_type)) {
        return err('INVALID_BATCH_TYPE', "batch_type deve ser 'quantity' ou 'date'", 400)
      }
      if (typeof b.price_brl !== 'number' || b.price_brl < 0) {
        return err('INVALID_BATCH_PRICE', 'price_brl deve ser >= 0', 400)
      }
      if (typeof b.capacity !== 'number' || b.capacity < 1) {
        return err('INVALID_BATCH_CAPACITY', 'capacity deve ser >= 1', 400)
      }
      if (b.batch_type === 'date' && !b.valid_until) {
        return err('MISSING_VALID_UNTIL', 'Lote por data requer valid_until', 400)
      }
    }
  }

  // ── Buscar usuário ──────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Verificar permissão: owner ou admin ativo do space ──────────────────────

  const { data: membership } = await supabaseAdmin
    .from('space_members')
    .select('role, status')
    .eq('space_id', space_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (
    !membership ||
    membership.status !== 'active' ||
    !['owner', 'admin'].includes(membership.role)
  ) {
    return err('FORBIDDEN', 'Sem permissão para criar eventos neste Lounge', 403)
  }

  // ── Inserir evento ──────────────────────────────────────────────────────────

  const { data: event, error: eventErr } = await supabaseAdmin
    .from('events')
    .insert({
      space_id,
      creator_id:      user.id,
      name:            name.trim(),
      description:     description?.trim() ?? null,
      date:            eventDate.toISOString(),
      visibility,
      is_paid,
      is_recurring:    is_recurring ?? false,
      recurrence_freq: is_recurring ? (recurrence_freq ?? null) : null,
      status:          'active',
    })
    .select('id, name, date, visibility, is_paid, is_recurring, status, created_at')
    .single()

  if (eventErr || !event) {
    await logError(supabaseAdmin, 'event-create', eventErr ?? new Error('event_insert_failed'), { space_id, name })
    return err('DB_ERROR', 'Erro ao criar evento', 500)
  }

  // ── Montar lotes ────────────────────────────────────────────────────────────
  // Evento pago: lotes fornecidos (primeiro ativo, demais pending)
  // Evento gratuito: 1 lote implícito com price=0 e capacity=9999

  const batchRows = is_paid && batches
    ? batches.map((b, i) => ({
        event_id:     event.id,
        batch_number: i + 1,
        batch_type:   b.batch_type,
        price_brl:    b.price_brl,
        capacity:     b.capacity,
        valid_until:  b.valid_until ?? null,
        status:       i === 0 ? 'active' : 'pending',
      }))
    : [{
        event_id:     event.id,
        batch_number: 1,
        batch_type:   'quantity' as const,
        price_brl:    0,
        capacity:     9999,
        valid_until:  null,
        status:       'active',
      }]

  // ── Inserir lotes ──────────────────────────────────────────────────────────

  const { data: insertedBatches, error: batchErr } = await supabaseAdmin
    .from('event_batches')
    .insert(batchRows)
    .select('id, batch_number, batch_type, price_brl, capacity, sold, valid_until, status')

  if (batchErr || !insertedBatches) {
    await supabaseAdmin.from('events').delete().eq('id', event.id)
    await logError(supabaseAdmin, 'event-create', batchErr ?? new Error('batch_insert_failed'), { event_id: event.id })
    return err('DB_ERROR', 'Erro ao criar lotes do evento', 500)
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    user.id,
    event_type: 'event_created',
    metadata:   { event_id: event.id, space_id, name, is_paid, batch_count: batchRows.length },
  })

  return json({
    event_id:    event.id,
    name:        event.name,
    date:        event.date,
    visibility:  event.visibility,
    is_paid:     event.is_paid,
    is_recurring: event.is_recurring,
    status:      event.status,
    created_at:  event.created_at,
    batches:     insertedBatches.map(b => ({
      id:           b.id,
      batch_number: b.batch_number,
      batch_type:   b.batch_type,
      price_brl:    b.price_brl,
      capacity:     b.capacity,
      sold:         b.sold,
      valid_until:  b.valid_until,
      status:       b.status,
    })),
  })
})
