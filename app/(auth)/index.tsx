// Design: /design/auth.jsx — SplashScreen
// Verifica sessão e redireciona: válida → (app) | sem sessão → welcome

import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AlberLogo } from '../../components/core/AlberLogo'
import { useAuthStore } from '../../store/auth.store'
import { registerPushToken } from '../../services/notifications.service'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'

export default function SplashScreen() {
  const { t }          = useTranslation()
  const insets         = useSafeAreaInsets()
  const loadSession    = useAuthStore(s => s.loadSession)
  const scale   = useRef(new Animated.Value(0.65)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 70,
        friction: 8,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }),
    ]).start()

    // Restaura sessão do SecureStore; redireciona conforme resultado
    loadSession().then(() => {
      const { isAuthenticated, token } = useAuthStore.getState()
      if (isAuthenticated && token) {
        registerPushToken(token).catch(() => {})  // best-effort
      }
      router.replace(isAuthenticated ? '/(app)/' : '/(auth)/welcome')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <AlberLogo size={64} />
      </Animated.View>

      <Text style={[styles.tagline, { bottom: Math.max(insets.bottom + 24, 60) }]}>
        {t('auth.splash.tagline')}
      </Text>
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
  logo: {},
  tagline: {
    position: 'absolute',
    fontSize: 10,
    letterSpacing: 0.2 * 10,
    color: 'rgba(255,255,255,0.25)',
    fontFamily: typography.fontFamily.primary,
  },
})
