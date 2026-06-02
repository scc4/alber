// Spec: /specs/01_frontend.md §7 (permissões — Notificações push)
// Solicitação após onboarding. Best-effort: nunca bloqueia o fluxo principal.

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// ── Permissões ────────────────────────────────────────────────────────────────

export async function requestPermissions(): Promise<boolean> {
  if (!Device.isDevice) return false   // simulador não recebe push real

  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === 'granted') return true

  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

// ── Registro do token ──────────────────────────────────────────────────────────

export async function registerPushToken(authToken: string): Promise<void> {
  if (!Device.isDevice) return

  const granted = await requestPermissions()
  if (!granted) return

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? ''
  if (!projectId) {
    console.warn('[push] projectId not found in app.json extra.eas')
    return
  }

  let pushTokenData: Notifications.ExpoPushToken
  try {
    pushTokenData = await Notifications.getExpoPushTokenAsync({ projectId })
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync failed:', e)
    return
  }

  const platform = Device.osName?.toLowerCase() === 'android' ? 'android' : 'ios'

  try {
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
    console.warn('[push] push-register failed:', e)
  }
}

// ── Notificação local (testes) ─────────────────────────────────────────────────

export async function scheduleLocal(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger:  null,  // disparo imediato
  })
}
