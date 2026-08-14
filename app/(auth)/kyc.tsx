// Tela de KYC pós-cadastro — abre o onboardingUrl da subconta Asaas em WebView interna.
// Spec: /specs/06_modules/onboarding.md §4  |  /specs/04_api_asaas.md §4.7
// Strings hardcoded: novos i18n keys devem ser adicionados a locales/pt-BR.json
//   auth.kyc.onboarding.eyebrow, title, body, note, ctaVerify, ctaDone
//
// Plano velvet-puzzling-sedgewick: aceita uma FILA de URLs (`urls`, com
// `labels` opcional em paralelo) em vez de uma única — cobre o cadastro de
// empresa, que pode ter onboarding pessoal e de empresa na mesma sessão de
// cadastro. Cada "Já fiz a verificação" avança pra próxima da fila; só
// resolve a rota inicial quando a fila esvazia.

import { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AsaasBadge } from '../../components/shared/AsaasBadge'
import { WebViewModal } from '../../components/shared/WebViewModal'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { resolveInitialRoute } from '../../hooks/useInitialRoute'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

// urls/labels chegam como JSON stringificado (mais previsível entre
// plataformas do que arrays de query param) — ver montagem em cadastro/pix.tsx.
function parseQueue(v: string | undefined): string[] {
  if (!v) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : [v]
  } catch { return v ? [v] : [] }
}

export default function KycScreen() {
  const params  = useLocalSearchParams<{ urls: string; labels?: string }>()
  const insets  = useSafeAreaInsets()

  const urlQueue   = parseQueue(params.urls)
  const labelQueue = parseQueue(params.labels)

  const [step, setStep]                     = useState(0)
  const [webViewVisible, setWebViewVisible] = useState(false)

  const url   = urlQueue[step] ?? ''
  const label = labelQueue[step] ?? ''
  const hasNext = step + 1 < urlQueue.length

  const handleVerify = () => {
    if (url) setWebViewVisible(true)
  }

  const handleDone = async () => {
    if (hasNext) {
      setStep(s => s + 1)
      return
    }
    router.replace((await resolveInitialRoute()) as never)
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      <WebViewModal
        visible={webViewVisible}
        url={url ?? ''}
        title={label === 'empresa' ? 'Verificação da empresa' : 'Verificação de identidade'}
        onClose={() => setWebViewVisible(false)}
      />

      {/* Conteúdo central */}
      <View style={styles.content}>
        <Text style={styles.eyebrow}>
          {label === 'empresa' ? 'VERIFICAÇÃO DA EMPRESA' : 'VERIFICAÇÃO DE IDENTIDADE'}
          {urlQueue.length > 1 ? ` · ${step + 1}/${urlQueue.length}` : ''}
        </Text>
        <Text style={styles.title}>
          {label === 'empresa' ? 'Ative a conta da sua empresa' : 'Ative sua conta financeira'}
        </Text>
        <Text style={styles.body}>
          {label === 'empresa'
            ? 'Para ativar a conta financeira da sua empresa precisamos verificar os documentos dela. Você será redirecionado para uma página segura.'
            : 'Para ativar sua conta financeira precisamos verificar sua identidade. Você será redirecionado para uma página segura.'}
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
          <Text style={styles.secondaryText}>
            {hasNext ? 'Já fiz a verificação — próxima etapa' : 'Já fiz a verificação'}
          </Text>
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
