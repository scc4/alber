// Perfil > Notificações — persiste de verdade as preferências por categoria
// (antes eram só de interface; ver migration 046 e o enforcement em
// push-send). Aceita qualquer subconjunto das colunas — só atualiza o que
// veio no body, não sobrescreve o resto.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

const VALID_COLUMNS = [
  'notif_tx_receive', 'notif_tx_send', 'notif_tx_carregar', 'notif_tx_descarregar',
  'notif_split_participant', 'notif_split_expired', 'notif_split_closed',
  'notif_lounge_message', 'notif_lounge_event', 'notif_lounge_request',
  'notif_conta_kyc',
] as const

type ValidColumn = typeof VALID_COLUMNS[number]

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const updates: Partial<Record<ValidColumn, boolean>> = {}
  for (const key of VALID_COLUMNS) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') return err('INVALID_FIELD', `${key} precisa ser boolean`, 400)
      updates[key] = body[key] as boolean
    }
  }

  if (Object.keys(updates).length === 0) {
    return err('MISSING_FIELDS', 'Nenhuma preferência válida enviada', 400)
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, deleted_at')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user || user.deleted_at) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', user.id)
    .select(VALID_COLUMNS.join(', '))
    .single()

  if (updateErr || !updated) {
    console.error('[perfil-update-notification-prefs] update error:', updateErr)
    return err('DB_ERROR', 'Erro ao atualizar preferências', 500)
  }

  return json(updated)
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
