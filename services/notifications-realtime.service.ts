// Spec: sino de notificações (Home) — badge em tempo real
// Client Supabase dedicado ao Realtime (postgres_changes). O app não usa
// supabase.auth (login é via BFF customizado — ver auth.service.ts), então
// aqui só habilitamos auth.persistSession/autoRefreshToken=false e passamos
// o JWT já emitido pelo login para o socket via `realtime.setAuth`.

import 'react-native-url-polyfill/auto'
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import type { DbNotificationRow } from './notifications.service'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY     = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

export function setRealtimeAuth(jwt: string): void {
  supabase.realtime.setAuth(jwt)
}

export function subscribeToNotifications(
  userId: string,
  onInsert: (row: DbNotificationRow) => void,
): () => void {
  let channel: RealtimeChannel | null = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new as DbNotificationRow),
    )
    .subscribe()

  return () => {
    if (!channel) return
    supabase.removeChannel(channel)
    channel = null
  }
}
