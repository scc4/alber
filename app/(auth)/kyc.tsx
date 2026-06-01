// Tela de KYC pós-cadastro — abre o onboardingUrl da subconta Asaas no browser externo.
// Spec: /specs/06_modules/onboarding.md §4  |  /specs/04_api_asaas.md §4.7
// Strings hardcoded: novos i18n keys devem ser adicionados a locales/pt-BR.json
//   auth.kyc.onboarding.eyebrow, title, body, note, ctaVerify, ctaDone

import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AsaasBadge } from '../../components/shared/AsaasBadge'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

export default function KycScreen() {
  const { url } = useLocalSearchParams<{ url: string }>()
  const insets  = useSafeAreaInsets()

  const handleVerify = async () => {
    if (url) await Linking.openURL(url)
  }

  const handleDone = () => {
    router.replace('/(app)/')
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>

      {/* Conteúdo central */}
      <View style={styles.content}>
        <Text style={styles.eyebrow}>VERIFICAÇÃO DE IDENTIDADE</Text>
        <Text style={styles.title}>Ative sua conta financeira</Text>
        <Text style={styles.body}>
          Para ativar sua conta financeira precisamos verificar sua identidade.
          Você será redirecionado para uma página segura.
        </Text>
        <View style={styles.noteRow}>
          <Text style={styles.noteText}>A verificação leva menos de 5 minutos</Text>
        </View>
      </View>

      {/* Rodapé com badge e botões */}
      <View style={styles.footer}>
        <AsaasBadge />
        <View style={styles.buttonGap} />
        <PrimaryButton
          label="Verificar minha identidade"
          onPress={handleVerify}
          state={url ? 'default' : 'disabled'}
        />
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleDone}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Já fiz a verificação</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
    paddingHorizontal: spacing.screenHorizontal,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.xl,
  },
  eyebrow: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.14 * 10,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 26,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.md,
  },
  body: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.60)',
    lineHeight: 23,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    alignSelf: 'flex-start',
  },
  noteText: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 18,
  },
  footer: {
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  buttonGap: {
    height: spacing.sm,
  },
  secondaryBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
  },
})
