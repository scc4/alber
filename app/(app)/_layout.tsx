import React from 'react'
import { View, StyleSheet } from 'react-native'
import { Stack, usePathname, router } from 'expo-router'
import { BottomNav, BottomNavItem } from '../../components/core/BottomNav'

// Rotas onde o BottomNav deve aparecer
const NAV_PATHS = new Set(['/', '/atividade', '/achar', '/lounge', '/perfil'])

function getActiveTab(pathname: string): BottomNavItem | string {
  if (pathname === '/atividade') return 'atividade'
  if (pathname === '/achar')     return 'achar'
  if (pathname === '/lounge')    return 'lounge'
  if (pathname === '/perfil')    return 'perfil'
  return ''  // home — nenhum tab ativo
}

function handleNavigate(item: BottomNavItem) {
  switch (item) {
    case 'perfil':    router.push('/(app)/perfil');    break
    case 'achar':     router.push('/(app)/achar');     break
    case 'lounge':    router.push('/(app)/lounge');    break
    case 'atividade': router.push('/(app)/atividade'); break
  }
}

export default function AppLayout() {
  const pathname = usePathname()
  const showNav  = NAV_PATHS.has(pathname)
  const active   = getActiveTab(pathname)

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
