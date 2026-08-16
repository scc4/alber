// Função interna — NÃO exposta ao app mobile.
// Chamada apenas por outras Edge Functions com service role.
// POST /push-send
// Body: { user_id, title, body, data? }
// Busca tokens ativos do usuário e envia via Expo Push API.
// Marca tokens inválidos como inactive (DeviceNotRegistered).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { json, err } from '../_shared/cors.ts'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type NotifCategory =
  | 'tx_receive' | 'tx_send' | 'tx_carregar' | 'tx_descarregar'
  | 'split_participant' | 'split_closed'
  | 'lounge_message' | 'lounge_event' | 'lounge_request'
  | 'conta_kyc'

// category → coluna users.notif_* que precisa estar true pra essa notificação
// sair. Ausente/não-mapeada = não-configurável, sempre envia (segurança, convites
// sem categoria própria na tela de preferências).
const CATEGORY_COLUMN: Record<NotifCategory, string> = {
  tx_receive:         'notif_tx_receive',
  tx_send:            'notif_tx_send',
  tx_carregar:        'notif_tx_carregar',
  tx_descarregar:     'notif_tx_descarregar',
  split_participant:  'notif_split_participant',
  split_closed:       'notif_split_closed',
  lounge_message:     'notif_lounge_message',
  lounge_event:       'notif_lounge_event',
  lounge_request:     'notif_lounge_request',
  conta_kyc:          'notif_conta_kyc',
}

interface PushSendRequest {
  user_id:   string
  title:     string
  body:      string
  data?:     Record<string, string>
  type?:     'transaction' | 'invite' | 'other'
  category?: NotifCategory
}

interface ExpoReceipt {
  status:  'ok' | 'error'
  message?: string
  details?: { error?: string }
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

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

  const { user_id, title, body: msgBody, data, type, category } = body
  if (!user_id || !title || !msgBody) {
    return err('MISSING_FIELDS', 'user_id, title e body são obrigatórios', 400)
  }

  // ── Checar preferência do usuário (Perfil > Notificações) ────────────────────
  // category ausente/sem coluna mapeada = notificação não-configurável, sempre
  // envia (segurança, convites sem categoria própria na tela de preferências).

  if (category && CATEGORY_COLUMN[category]) {
    const column = CATEGORY_COLUMN[category]
    const { data: prefRow } = await supabaseAdmin
      .from('users')
      .select(column)
      .eq('id', user_id)
      .maybeSingle()

    const enabled = (prefRow as Record<string, boolean> | null)?.[column] ?? true
    if (!enabled) {
      return json({ sent: 0, reason: 'muted', category })
    }
  }

  // ── Registrar notificação in-app (independe de haver token ativo) ────────────

  await supabaseAdmin.from('notifications').insert({
    user_id,
    type:     type ?? 'other',
    title,
    body:     msgBody,
    route:    data?.route ?? null,
    metadata: data ?? {},
  }).then(({ error }) => {
    if (error) console.error('[push-send] notification insert failed:', error)
  })

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
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
