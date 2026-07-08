// Spec: /specs/05_security.md seção 3 — Confirmação de segurança
// Design: /design/pin.jsx — SecurityConfirm
// Challenge gerado pelo backend (auth-question): 1 pergunta + opções mascaradas aleatórias.

import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { fetchSecurityChallenge, SecurityChallenge } from '../../services/auth.service'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

export interface SecurityConfirmationProps {
  /** Handle (@joao) ou CPF (só dígitos) do usuário autenticado. */
  identifier: string
  /** Hash do PIN já capturado neste fluxo. */
  pinHash: string
  /** Texto do eyebrow opcional acima da pergunta. */
  eyebrow?: string
  /** Passa true enquanto o caller está submetendo ao backend — desabilita opções. */
  submitting?: boolean
  /** Passa true brevemente quando o backend rejeita a resposta (WRONG_SECURITY_ANSWER). */
  wrongAnswer?: boolean
  /** Callback com o hash da opção selecionada — enviar direto ao BFF. */
  onPass: (answerHash: string) => void
}

export function SecurityConfirmation({
  identifier,
  pinHash,
  eyebrow,
  submitting,
  wrongAnswer,
  onPass,
}: SecurityConfirmationProps) {
  const { t } = useTranslation()
  const [challenge, setChallenge] = useState<SecurityChallenge | null>(null)
  const [loading, setLoading]     = useState(true)
  const [fetchErr, setFetchErr]   = useState(false)
  const shakeX = React.useRef(new Animated.Value(0)).current

  const load = useCallback(() => {
    setLoading(true)
    setFetchErr(false)
    setChallenge(null)
    fetchSecurityChallenge(identifier, pinHash)
      .then(r => {
        if (r && r !== 'PIN_SETUP_REQUIRED' && r.options.length) setChallenge(r); else setFetchErr(true)
      })
      .catch(() => setFetchErr(true))
      .finally(() => setLoading(false))
  }, [identifier, pinHash])

  useEffect(() => { load() }, [load])

  // Anima shake quando wrongAnswer passa de false→true
  const prevWrong = React.useRef(false)
  useEffect(() => {
    if (wrongAnswer && !prevWrong.current) {
      Animated.sequence([
        Animated.timing(shakeX, { toValue: 10,  duration: 55, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: -10, duration: 55, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 8,   duration: 55, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 0,   duration: 55, useNativeDriver: true }),
      ]).start()
    }
    prevWrong.current = wrongAnswer ?? false
  }, [wrongAnswer])

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="rgba(255,255,255,0.4)" />
      </View>
    )
  }

  if (fetchErr || !challenge) {
    return (
      <View style={styles.container}>
        {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
        <Text style={styles.question}>{t('auth.login.securityLoadError')}</Text>
        <TouchableOpacity style={styles.retryCta} onPress={load} activeOpacity={0.75}>
          <Text style={styles.retryCtaText}>{t('auth.login.securityRetry')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text style={styles.title}>{t('auth.security.title')}</Text>
      <Text style={styles.question}>{challenge.question}</Text>
      <Text style={styles.hint}>{t('auth.login.securityChooseHint')}</Text>

      <Animated.View style={[styles.optionsList, { transform: [{ translateX: shakeX }] }]}>
        {challenge.options.map((opt, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.option, (submitting) && styles.optionDisabled]}
            onPress={() => onPass(opt.hash)}
            disabled={submitting}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={opt.display}
          >
            <Text style={[styles.optionText, wrongAnswer && styles.optionTextWrong]}>
              {opt.display}
            </Text>
          </TouchableOpacity>
        ))}
      </Animated.View>

      {wrongAnswer && (
        <Text style={styles.wrongHint}>{t('auth.login.securityWrongChoice')}</Text>
      )}
      {submitting && (
        <Text style={styles.hint}>{t('common.verifying')}</Text>
      )}
    </ScrollView>
  )
}

// Mantido para backward compat de imports antigos — não usar em código novo.
export interface SecurityQuestion {
  question: string
  answer?: string
  options?: string[]
  maskedAnswer?: string
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  eyebrow: {
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: typography.eyebrow.textTransform,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: typography.size.h1.fontSize,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.015 * typography.size.h1.fontSize,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  question: {
    fontSize: typography.size.label.fontSize,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: typography.size.label.lineHeight,
    marginBottom: spacing.lg,
  },
  hint: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  optionsList: {
    gap: 10,
  },
  option: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: spacing.radius.md,
    padding: 18,
    paddingHorizontal: 20,
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionText: {
    fontSize: 15,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 1.2,
  },
  optionTextWrong: {
    color: colors.state.error,
  },
  wrongHint: {
    fontSize: typography.size.caption.fontSize,
    color: colors.state.error,
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  retryCta: {
    marginTop: spacing.xl,
    height: spacing.buttonHeight,
    borderRadius: spacing.radius.md,
    backgroundColor: colors.white[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryCtaText: {
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    fontSize: 15,
    color: colors.black[100],
  },
})
