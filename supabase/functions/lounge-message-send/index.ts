// Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão — Mensagens"
// POST /lounge-message-send
// Owner ou admin publica mensagem para todos os membros (push + feed persistente)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface MessageRequest {
  space_id: string
  content:  string
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

  let body: MessageRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { space_id, content } = body
  if (!space_id) return err('MISSING_FIELDS', 'space_id é obrigatório', 400)
  if (!content?.trim()) return err('MISSING_FIELDS', 'content é obrigatório', 400)
  if (content.trim().length > 500) return err('CONTENT_TOO_LONG', 'Mensagem deve ter até 500 caracteres', 422)

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id, name, handle')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Verificar permissão: owner ou admin ativo ───────────────────────────────

  const { data: membership } = await supabaseAdmin
    .from('space_members')
    .select('role, status')
    .eq('space_id', space_id)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!membership || membership.status !== 'active' || !['owner', 'admin'].includes(membership.role)) {
    return err('FORBIDDEN', 'Apenas owner ou gestor pode enviar mensagens', 403)
  }

  // ── Inserir mensagem ────────────────────────────────────────────────────────

  const { data: message, error: insertErr } = await supabaseAdmin
    .from('lounge_messages')
    .insert({
      space_id,
      author_id:   caller.id,
      author_role: membership.role as 'owner' | 'admin',
      content:     content.trim(),
    })
    .select('id, space_id, author_id, author_role, content, created_at')
    .single()

  if (insertErr || !message) {
    await logError(supabaseAdmin, 'lounge-message-send', insertErr ?? new Error('insert_failed'), { space_id })
    return err('DB_ERROR', 'Erro ao enviar mensagem', 500)
  }

  // ── Notificar membros ativos (best-effort, exceto o autor) ──────────────────

  const { data: members } = await supabaseAdmin
    .from('space_members')
    .select('user_id')
    .eq('space_id', space_id)
    .eq('status', 'active')
    .neq('user_id', caller.id)

  const preview = content.trim().length > 50 ? content.trim().slice(0, 47) + '…' : content.trim()
  const authorLabel = caller.name ?? caller.handle ?? 'Gestor'

  const pushPromises = (members ?? []).map(m =>
    sendPush(m.user_id, authorLabel, preview, { route: `/(app)/lounge/${space_id}` })
  )

  await Promise.allSettled([
    ...pushPromises,
    supabaseAdmin.from('audit_logs').insert({
      user_id:    caller.id,
      event_type: 'lounge_message_sent',
      metadata:   { space_id, message_id: message.id },
    }),
  ])

  return json({
    id:            message.id,
    author_id:     caller.id,
    author_name:   caller.name ?? '',
    author_handle: caller.handle ?? '',
    author_role:   message.author_role,
    content:       message.content,
    created_at:    message.created_at,
  })
})
