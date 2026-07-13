// Spec: /specs/01_frontend.md §7 (permissões — Notificações push)
// Solicitação após onboarding. Best-effort: nunca bloqueia o fluxo principal.
// expo-notifications não está disponível no Expo Go SDK 53+ — import dinâmico
// dentro de cada função garante que o módulo só é carregado em runtime.

import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { BffError } from './auth.service'
import type { NotificationItem } from '../store/notifications.store'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const REST     = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/rest/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// ── Permissões ────────────────────────────────────────────────────────────────

export async function requestPermissions(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false

    const Notifications = await import('expo-notifications')

    const { status: existing } = await Notifications.getPermissionsAsync()
    if (existing === 'granted') return true

    const { status } = await Notifications.requestPermissionsAsync()
    return status === 'granted'
  } catch (e) {
    console.log('[notifications] not available:', e)
    return false
  }
}

// ── Registro do token ──────────────────────────────────────────────────────────

export async function registerPushToken(authToken: string): Promise<void> {
  try {
    if (!Device.isDevice) return

    const granted = await requestPermissions()
    if (!granted) return

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? ''
    if (!projectId) {
      console.warn('[push] projectId not found in app.json extra.eas')
      return
    }

    const Notifications  = await import('expo-notifications')
    const pushTokenData  = await Notifications.getExpoPushTokenAsync({ projectId })
    const platform       = Device.osName?.toLowerCase() === 'android' ? 'android' : 'ios'

    await fetch(`${BFF}/push-register`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${authToken}`,
        apikey:         ANON_KEY,
      },
      body: JSON.stringify({ token: pushTokenData.data, platform }),
    })
  } catch (e) {
    console.log('[notifications] not available:', e)
  }
}

// ── Notificação local (testes) ─────────────────────────────────────────────────

export async function scheduleLocal(title: string, body: string): Promise<void> {
  try {
    const Notifications = await import('expo-notifications')
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger:  null,
    })
  } catch (e) {
    console.log('[notifications] not available:', e)
  }
}

// ── Central de notificações (sininho) ──────────────────────────────────────────

export interface DbNotificationRow {
  id:         string
  type:       'transaction' | 'invite' | 'other'
  title:      string
  body:       string
  route:      string | null
  read_at:    string | null
  created_at: string
}

export function mapNotificationRow(r: DbNotificationRow): NotificationItem {
  return {
    id:        r.id,
    type:      r.type,
    title:     r.title,
    body:      r.body,
    route:     r.route,
    read:      r.read_at !== null,
    createdAt: r.created_at,
  }
}

export async function getNotifications(token: string, limit = 30): Promise<NotificationItem[]> {
  const res = await fetch(
    `${REST}/notifications?select=id,type,title,body,route,read_at,created_at&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  )
  if (!res.ok) throw new BffError('REST_ERROR', 'Erro ao carregar notificações', res.status)
  const rows = await res.json() as DbNotificationRow[]
  return rows.map(mapNotificationRow)
}

export async function markNotificationsRead(
  params: { ids?: string[]; all?: boolean },
  token:  string,
): Promise<void> {
  const res  = await fetch(`${BFF}/notifications-mark-read`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    body:    JSON.stringify(params),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new BffError(String(data.code ?? 'UNKNOWN'), String(data.message ?? 'Erro'), res.status)
  }
}
