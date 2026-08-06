// Spec: /specs/06_modules/atividade.md
// GET /financial-atividade?tipo=all|in|out|split|ticket&page=0&limit=20
// Retorna histórico paginado de transações do usuário autenticado.
// Counterpart (name + handle) resolvido via batch query em users.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

// tipos por filtro (alinhado com spec atividade.md §5)
const TIPO_FILTER: Record<string, string[]> = {
  in:     ['carregar', 'receber', 'split_release', 'event_refund', 'transferir_recebido'],
  out:    ['descarregar', 'enviar', 'split_debit', 'event_purchase', 'fee', 'transferir_enviado'],
  split:  ['split_block', 'split_release', 'split_debit'],
  ticket: ['event_purchase', 'event_refund'],
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'GET') return err('METHOD_NOT_ALLOWED', 'Use GET', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

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

  // ── Buscar usuário ──────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Query params ────────────────────────────────────────────────────────────

  const url   = new URL(req.url)
  const tipo  = url.searchParams.get('tipo') ?? 'all'
  const page  = Math.max(0, parseInt(url.searchParams.get('page')  ?? '0',  10) || 0)
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20))

  // ── Buscar transações ───────────────────────────────────────────────────────

  let query = supabaseAdmin
    .from('transactions')
    .select(
      'id, type, amount, amount_brl, fee_amount, status, reference_id, reference_type, metadata, created_at',
      { count: 'exact' },
    )
    .eq('user_id', user.id)
    // Atividade é um extrato — só movimentações que de fato aconteceram.
    // pending/processing/failed nunca chegaram a se efetivar e não devem aparecer.
    .in('status', ['completed', 'refunded'])
    .order('created_at', { ascending: false })
    .range(page * limit, page * limit + limit - 1)

  if (tipo !== 'all' && TIPO_FILTER[tipo]) {
    query = query.in('type', TIPO_FILTER[tipo])
  }

  const { data: rows, count, error: txErr } = await query
  if (txErr) return err('DB_ERROR', 'Erro ao buscar transações', 500)

  // ── Resolver counterparts via batch query ───────────────────────────────────

  const counterpartIds = new Set<string>()
  for (const row of rows ?? []) {
    const m = (row.metadata ?? {}) as Record<string, string>
    if (m.payer_id)        counterpartIds.add(m.payer_id)
    if (m.receiver_id)     counterpartIds.add(m.receiver_id)
    if (m.destinatario_id) counterpartIds.add(m.destinatario_id)
    if (m.remetente_id)    counterpartIds.add(m.remetente_id)
  }

  const userMap: Record<string, { name: string; handle: string }> = {}
  if (counterpartIds.size > 0) {
    const { data: counterpartUsers } = await supabaseAdmin
      .from('users')
      .select('id, name, handle')
      .in('id', [...counterpartIds])
    for (const u of counterpartUsers ?? []) {
      userMap[u.id] = { name: u.name, handle: u.handle }
    }
  }

  // ── Mapear resposta ─────────────────────────────────────────────────────────

  const data = (rows ?? []).map(row => {
    const m = (row.metadata ?? {}) as Record<string, string>

    // Identificar counterpart (user ID prioritário, handle como fallback)
    const counterpartId = m.payer_id ?? m.receiver_id ?? m.destinatario_id ?? m.remetente_id
    let counterpart: { name: string; handle: string } | null = null

    if (counterpartId && userMap[counterpartId]) {
      counterpart = userMap[counterpartId]
    } else {
      const handle = m.payer_handle ?? m.receiver_handle ?? m.destinatario_handle ?? m.remetente_handle
      if (handle) counterpart = { name: '', handle }
    }

    // transferir_* mapeado para enviar/receber para compatibilidade com o frontend
    let type: string = row.type
    if (type === 'transferir_enviado')   type = 'enviar'
    if (type === 'transferir_recebido')  type = 'receber'

    return {
      id:           row.id,
      type,
      amount:       Number(row.amount),
      fee:          Number(row.fee_amount ?? 0),
      status:       row.status,
      created_at:   row.created_at,
      reference_id: row.reference_id ?? null,
      metadata:     m,
      counterpart,
    }
  })

  const total   = count ?? 0
  const hasMore = (page + 1) * limit < total

  return json({ data, total, hasMore })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
