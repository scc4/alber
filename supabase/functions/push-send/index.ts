// Função interna — NÃO exposta ao app mobile.
// Chamada apenas por outras Edge Functions com service role.
// POST /push-send
// Body: { user_id, title, body, data? }
// Busca tokens ativos do usuário e envia via Expo Push API.
// Marca tokens inválidos como inactive (DeviceNotRegistered).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { json, err } from '../_shared/cors.ts'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

interface PushSendRequest {
  user_id: string
  title:   string
  body:    string
  data?:   Record<string, string>
}

interface ExpoReceipt {
  status:  'ok' | 'error'
  message?: string
  details?: { error?: string }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Verificar que é chamada interna (service role key) ───────────────────────

  const authHeader = req.headers.get('Authorization')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
    return err('UNAUTHORIZED', 'Acesso restrito', 401)
  }

  // ── Parse body ──────────────────────────────────────────────────────────────

  let body: PushSendRequest
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { user_id, title, body: msgBody, data } = body
  if (!user_id || !title || !msgBody) {
    return err('MISSING_FIELDS', 'user_id, title e body são obrigatórios', 400)
  }

  // ── Buscar tokens ativos do usuário ──────────────────────────────────────────

  const { data: tokens } = await supabaseAdmin
    .from('push_tokens')
    .select('id, token')
    .eq('user_id', user_id)
    .eq('active', true)

  if (!tokens?.length) {
    return json({ sent: 0, reason: 'no_tokens' })
  }

  // ── Enviar via Expo Push API ─────────────────────────────────────────────────

  const messages = tokens.map(t => ({
    to:    t.token,
    title,
    body:  msgBody,
    data:  data ?? {},
    sound: 'default',
  }))

  let receipts: ExpoReceipt[] = []
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(messages),
    })
    const resJson = await res.json() as { data: ExpoReceipt[] }
    receipts = resJson.data ?? []
  } catch (e) {
    console.error('[push-send] Expo API call failed:', e)
    return json({ sent: 0, error: 'expo_api_failed' })
  }

  // ── Marcar tokens inválidos como inactive ─────────────────────────────────────

  const invalidTokenIds: string[] = []
  receipts.forEach((receipt, i) => {
    if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
      if (tokens[i]) invalidTokenIds.push(tokens[i].id)
    }
  })

  if (invalidTokenIds.length > 0) {
    await supabaseAdmin
      .from('push_tokens')
      .update({ active: false })
      .in('id', invalidTokenIds)
  }

  const sent = receipts.filter(r => r.status === 'ok').length
  console.log(`[push-send] user=${user_id} sent=${sent}/${tokens.length}`)

  return json({ sent, total: tokens.length })
})
