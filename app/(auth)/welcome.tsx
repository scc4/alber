// Design: /design/auth.jsx — WelcomeScreen
// Logo + tagline + dois CTAs: Cadastrar-se | Fazer login

import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { AlberLogo } from '../../components/core/AlberLogo'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

export default function WelcomeScreen() {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Centro — logo + tagline */}
      <View style={styles.center}>
        <AlberLogo size={72} />
        <Text style={styles.tagline}>{t('auth.splash.tagline')}</Text>
      </View>

      {/* Botões na base */}
      <View style={styles.buttons}>
        <PrimaryButton
          label={t('auth.welcome.signup')}
          onPress={() => router.push('/(auth)/cadastro/tipo-conta')}
          variant="primary"
        />
        <PrimaryButton
          label={t('auth.welcome.login')}
          onPress={() => router.push('/(auth)/login')}
          variant="ghost"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[90],
    flexDirection: 'column',
    paddingHorizontal: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  logo: {},
  tagline: {
    fontSize: 11,
    letterSpacing: 0.32 * 11,
    color: 'rgba(255,255,255,0.42)',
    marginTop: spacing.md,
    fontFamily: typography.fontFamily.primary,
  },
  buttons: {
    gap: 10,
    paddingBottom: spacing.xl,
  },
})
