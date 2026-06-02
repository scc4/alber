// Spec: /specs/01_frontend.md §7 (permissões — Notificações push)
// Solicitação após onboarding. Best-effort: nunca bloqueia o fluxo principal.
// expo-notifications não está disponível no Expo Go SDK 53+ — import dinâmico
// dentro de cada função garante que o módulo só é carregado em runtime.

import * as Device from 'expo-device'
import Constants from 'expo-constants'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
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
