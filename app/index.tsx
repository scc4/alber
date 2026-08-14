// Árbitro único de navegação — decide (auth) vs (app) baseado na sessão.
// Único arquivo que resolve a URL "/": app/(auth)/index.tsx e app/(app)/index.tsx
// nunca são alcançados via "/" — a navegação sempre usa hrefs explícitos.

import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useAuthStore } from '../store/auth.store'
import { useActiveContextStore } from '../store/active-context.store'
import { resolveInitialRoute } from '../hooks/useInitialRoute'
import { colors } from '../tokens/colors'

export default function Index() {
  useEffect(() => {
    const init = async () => {
      const authStore = useAuthStore.getState()
      await authStore.loadSession()
      const { isAuthenticated, user } = useAuthStore.getState()
      if (isAuthenticated && user) {
        // Restaura o contexto ativo da sessão anterior (pessoal/empresa X).
        // Só master/operador sem carteira pessoal precisa recalcular do zero
        // — quem tem carteira pessoal cai direto na Home de sempre, mesmo
        // que nunca tenha escolhido explicitamente um contexto ainda.
        await useActiveContextStore.getState().loadContext()
        const persisted = useActiveContextStore.getState().context
        const hasPersonalWallet = user.hasPersonalWallet !== false
        if (hasPersonalWallet || persisted.type === 'company') {
          router.replace('/(app)/')
        } else {
          router.replace((await resolveInitialRoute()) as never)
        }
      } else {
        await authStore.logout()
        router.replace('/(auth)/welcome')
      }
    }
    init()
  }, [])

  return (
    <View style={styles.root}>
      <ActivityIndicator color="rgba(255,255,255,0.6)" />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
})
