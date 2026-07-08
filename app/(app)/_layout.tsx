import React, { useEffect, useRef } from 'react'
import { AppState, View, StyleSheet } from 'react-native'
import { Stack, usePathname, router } from 'expo-router'
import { BottomNav, BottomNavItem } from '../../components/core/BottomNav'
import { useAuthStore, isJwtExpired } from '../../store/auth.store'

// Rotas onde o BottomNav deve aparecer
const NAV_PATHS = new Set(['/', '/atividade', '/achar', '/lounge', '/perfil'])

function getActiveTab(pathname: string): BottomNavItem | string {
  if (pathname === '/')          return 'home'
  if (pathname === '/atividade') return 'atividade'
  if (pathname === '/achar')     return 'achar'
  if (pathname === '/lounge')    return 'lounge'
  return ''
}

function handleNavigate(item: BottomNavItem) {
  switch (item) {
    case 'home':      router.replace('/(app)/');        break
    case 'achar':     router.push('/(app)/achar');     break
    case 'lounge':    router.push('/(app)/lounge');    break
    case 'atividade': router.push('/(app)/atividade'); break
  }
}

export default function AppLayout() {
  const pathname        = usePathname()
  const showNav         = NAV_PATHS.has(pathname)
  const active          = getActiveTab(pathname)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const user             = useAuthStore(s => s.user)
  const isLoadingSession = useAuthStore(s => s.isLoadingSession)

  const notifListener    = useRef<{ remove: () => void } | null>(null)
  const responseListener = useRef<{ remove: () => void } | null>(null)

  // Auth guard (spec 01_frontend §4)
  useEffect(() => {
    if (!isLoadingSession && (!isAuthenticated || !user)) {
      router.replace('/(auth)/welcome')
    }
  }, [isAuthenticated, user, isLoadingSession])

  // Recheca token ao retornar do background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const { token } = useAuthStore.getState()
        if (token && isJwtExpired(token)) {
          useAuthStore.getState().logout()
          router.replace('/(auth)/welcome')
        }
      }
    })
    return () => subscription.remove()
  }, [])

  // Setup de notificações push (expo-notifications indisponível no Expo Go SDK 53+)
  useEffect(() => {
    const setupNotifications = async () => {
      try {
        const Notifications = await import('expo-notifications')

        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge:  false,
          }),
        })

        notifListener.current = Notifications.addNotificationReceivedListener(_notification => {
          // A notificação já aparece via setNotificationHandler acima — sem ação adicional
        })

        responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
          const data = (response.notification.request.content.data ?? {}) as Record<string, string>
          if (data.route) {
            router.push(data.route as Parameters<typeof router.push>[0])
          }
        })
      } catch (e) {
        console.log('[notifications] not available:', e)
      }
    }

    setupNotifications()

    return () => {
      try { notifListener.current?.remove() } catch {}
      try { responseListener.current?.remove() } catch {}
    }
  }, [])

  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#000' },
        }}
      >
        {/* Tab screens */}
        <Stack.Screen name="index" />
        <Stack.Screen name="atividade" />
        <Stack.Screen name="achar" />
        <Stack.Screen name="lounge/index" />
        <Stack.Screen name="perfil/index" />

        {/* Flows — sem BottomNav */}
        <Stack.Screen name="carregar" />
        <Stack.Screen name="receber" />
        <Stack.Screen name="transferir" />

        {/* Split */}
        <Stack.Screen name="split/index" />
        <Stack.Screen name="split/criar" />
        <Stack.Screen name="split/[id]" />
        <Stack.Screen name="split/fechar/[id]" />
        <Stack.Screen name="split/convite/[token]" />

        {/* Lounge */}
        <Stack.Screen name="lounge/[id]" />
        <Stack.Screen name="lounge/criar" />
        <Stack.Screen name="lounge/gerenciar/[id]" />
        <Stack.Screen name="lounge/criar-evento/[id]" />
        <Stack.Screen name="lounge/evento/[id]" />

        {/* Perfil */}
        <Stack.Screen name="perfil/dados" />
        <Stack.Screen name="perfil/handle" />
        <Stack.Screen name="perfil/seguranca" />
        <Stack.Screen name="perfil/kyc" />
        <Stack.Screen name="perfil/notificacoes" />
      </Stack>

      {showNav && (
        <BottomNav active={active} onNavigate={handleNavigate} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
})
