// Spec: /specs/06_modules/alber_lounge.md § 8.5 "Edição pós-publicação"
// POST /event-update { event_id, name?, description?, image_url?, date? }
// Edita campos permitidos e notifica todos os confirmados se algo mudou.
// NÃO permite alterar: is_paid, lotes, capacidade.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface UpdateRequest {
  event_id:     string
  name?:        string
  description?: string
  image_url?:   string | null
  date?:        string   // ISO 8601 UTC
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
  let body: UpdateRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }
  if (!body.event_id) return err('MISSING_FIELDS', 'event_id é obrigatório', 400)

  const { event_id, name, description, image_url, date } = body

  if (name !== undefined && !name.trim()) {
    return err('INVALID_NAME', 'Nome não pode ser vazio', 400)
  }
  let parsedDate: Date | null = null
  if (date !== undefined) {
    parsedDate = new Date(date)
    if (isNaN(parsedDate.getTime())) {
      return err('INVALID_DATE', 'Data inválida', 400)
    }
    if (parsedDate <= new Date()) {
      return err('INVALID_DATE', 'A data do evento deve ser no futuro', 400)
    }
  }

  // ── Buscar caller + evento em paralelo ────────────────────────────────────────
  const [userRes, eventRes] = await Promise.all([
    supabaseAdmin.from('users').select('id').eq('auth_id', authUser.id).maybeSingle(),
    supabaseAdmin
      .from('events')
      .select('id, name, description, image_url, date, space_id, status')
      .eq('id', event_id)
      .maybeSingle(),
  ])

  const caller = userRes.data
  const event  = eventRes.data

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  if (!event || event.status === 'cancelled') {
    return err('EVENT_NOT_FOUND', 'Evento não encontrado ou cancelado', 404)
  }

  // ── Verificar permissão ────────────────────────────────────────────────────────
  const { data: membership } = await supabaseAdmin
    .from('space_members')
    .select('role, status')
    .eq('space_id', event.space_id)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!membership || membership.status !== 'active' || !['owner', 'admin'].includes(membership.role)) {
    return err('FORBIDDEN', 'Apenas donos e gestores podem editar eventos', 403)
  }

  // ── Montar patch: apenas campos explicitamente passados que realmente mudaram ──
  const patch: Record<string, unknown> = {}
  if (name        !== undefined && name.trim()  !== event.name)              patch.name        = name.trim()
  if (description !== undefined && description  !== (event.description ?? '')) patch.description = description
  if (image_url   !== undefined && image_url    !== event.image_url)         patch.image_url   = image_url
  if (parsedDate) {
    const currentDate = new Date(event.date)
    if (Math.abs(parsedDate.getTime() - currentDate.getTime()) > 60_000) {
      patch.date = parsedDate.toISOString()
    }
  }

  if (Object.keys(patch).length === 0) {
    return json({ event_id, updated: false, changes: [], message: 'Nenhuma alteração detectada' })
  }

  // ── Aplicar atualização ────────────────────────────────────────────────────────
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('events')
    .update(patch)
    .eq('id', event_id)
    .select('id, name, description, image_url, date, status')
    .single()

  if (updateErr || !updated) {
    await logError(supabaseAdmin, 'event-update', updateErr ?? new Error('update_failed'), { event_id })
    return err('DB_ERROR', 'Erro ao atualizar evento', 500)
  }

  // ── Notificar participantes com ingresso confirmado ────────────────────────────
  const { data: ticketUsers } = await supabaseAdmin
    .from('event_tickets')
    .select('user_id')
    .eq('event_id', event_id)
    .eq('status', 'confirmed')

  let notified = 0
  if (ticketUsers && ticketUsers.length > 0) {
    await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ticketUsers.map((t: any) =>
        sendPush(
          t.user_id,
          'Evento atualizado',
          `O evento "${updated.name}" foi atualizado. Verifique as novas informações.`,
          { route: `/(app)/lounge/evento/${event_id}` },
          undefined,
          'lounge_event',
        )
      )
    )
    notified = ticketUsers.length
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    caller.id,
    event_type: 'event_edited',
    metadata:   { event_id, changes: Object.keys(patch), notified },
  })

  return json({
    event_id,
    updated: true,
    changes: Object.keys(patch),
    event: {
      id:          updated.id,
      name:        updated.name,
      description: updated.description ?? '',
      image_url:   updated.image_url,
      date:        updated.date,
      status:      updated.status,
    },
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
