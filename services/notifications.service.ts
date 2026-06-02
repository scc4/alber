// Spec: /specs/01_frontend.md §7 (permissões — Notificações push)
// Solicitação após onboarding. Best-effort: nunca bloqueia o fluxo principal.
// expo-notifications não está disponível no Expo Go SDK 53+ — toda a lógica
// é envolvida em try/catch e falha silenciosamente.

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

const UNAVAILABLE_MSG = '[push] Push notifications não disponíveis no Expo Go'

// ── Permissões ────────────────────────────────────────────────────────────────

export async function requestPermissions(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false

    const { status: existing } = await Notifications.getPermissionsAsync()
    if (existing === 'granted') return true

    const { status } = await Notifications.requestPermissionsAsync()
    return status === 'granted'
  } catch {
    console.warn(UNAVAILABLE_MSG)
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

    const pushTokenData = await Notifications.getExpoPushTokenAsync({ projectId })

    const platform = Device.osName?.toLowerCase() === 'android' ? 'android' : 'ios'

    await fetch(`${BFF}/push-register`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${authToken}`,
        apikey:         ANON_KEY,
      },
      body: JSON.stringify({ token: pushTokenData.data, platform }),
    })
  } catch {
    console.warn(UNAVAILABLE_MSG)
  }
}

// ── Notificação local (testes) ─────────────────────────────────────────────────

export async function scheduleLocal(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger:  null,
    })
  } catch {
    console.warn(UNAVAILABLE_MSG)
  }
}
