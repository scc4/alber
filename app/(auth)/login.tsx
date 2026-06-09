// Design: /design/auth-login.jsx — LoginFlow
// Spec: /specs/06_modules/onboarding.md seção 5 — login de retorno
// Spec: /specs/03_backend.md §4.2
// 3 fases: id → pin → security (resposta digitada + hash → backend)

import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AlberLogo } from '../../components/core/AlberLogo'
import { PINInput } from '../../components/financial/PINInput'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { Field } from '../../components/core/Field'
import { useAuthStore } from '../../store/auth.store'
import * as authService from '../../services/auth.service'
import { sha256Hex, normalizeSecurityAnswer, legacyDevHash, maskAnswer, generateDecoys } from '../../utils/crypto'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

type Phase = 'id' | 'pin' | 'security'

interface SecurityOption {
  text:   string
  masked: string
  isReal: boolean
}

function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}

export default function LoginScreen() {
  const { t }    = useTranslation()
  const insets   = useSafeAreaInsets()
  const login    = useAuthStore(s => s.login)

  const [phase, setPhase]           = useState<Phase>('id')
  const [identifier, setIdentifier] = useState('')
  const [pinHash, setPinHash]       = useState('')
  const [pinMode, setPinMode]       = useState<'secure' | 'setup'>('secure')
  const [question, setQuestion]     = useState('')
  const [answer, setAnswer]           = useState('')
  const [secOptions, setSecOptions]   = useState<SecurityOption[]>([])
  const [secLoading, setSecLoading]   = useState(false)
  const [wrongChoice, setWrongChoice] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [pinError, setPinError]     = useState<string | null>(null)
  const pinErrKey = useRef(0)

  const isHandle = identifier.startsWith('@')
  const isValid  = isHandle
    ? identifier.replace(/^@/, '').length >= 3
    : identifier.replace(/\D/g, '').length === 11

  // Carrega pergunta do backend + respostas do SecureStore em paralelo
  useEffect(() => {
    if (phase !== 'security') return
    setSecOptions([])
    setWrongChoice(false)
    setAnswer('')
    setSecLoading(true)
    const cpfOrHandle = identifier.startsWith('@')
      ? identifier
      : identifier.replace(/\D/g, '')
    Promise.all([
      authService.fetchSecurityQuestions(cpfOrHandle),  // backend — sempre atualizado
      authService.getSecurityAnswers(),                  // SecureStore — para múltipla escolha
    ]).then(([backendQs, localAnswers]) => {
      // Usa primeira pergunta do backend (mais confiável que SecureStore)
      const q = backendQs[0]?.question ?? ''
      setQuestion(q)
      if (localAnswers.length > 0) {
        const real   = localAnswers[0]
        const decoys = generateDecoys(real, 4)
        const all: SecurityOption[] = [
          { text: real, masked: maskAnswer(real), isReal: true },
          ...decoys.map(d => ({ text: d, masked: maskAnswer(d), isReal: false })),
        ]
        setSecOptions(all.sort(() => Math.random() - 0.5))
      }
    }).finally(() => setSecLoading(false))
  }, [phase])

  const handleIdentifierChange = (v: string) => {
    if (v === '' || v === '@') { setIdentifier(v); return }
    const bare = v.startsWith('@') ? v.slice(1) : v
    if (/^\d/.test(bare)) {
      setIdentifier(maskCPF(bare))
    } else {
      setIdentifier('@' + bare.toLowerCase().replace(/[^a-z0-9_]/g, ''))
    }
  }

  const handlePINComplete = (hash: string) => {
    setPinHash(hash)
    setPinError(null)
    setTimeout(() => setPhase('security'), 200)
  }

  const submitSecurityAnswer = async (normalizedAnswer: string) => {
    if (isLoggingIn) return
    setIsLoggingIn(true)
    try {
      const answerHash       = await sha256Hex(normalizedAnswer)
      const legacyAnswerHash = legacyDevHash(normalizedAnswer)
      const cpfOrHandle      = isHandle ? identifier : identifier.replace(/\D/g, '')
      await login(cpfOrHandle, pinHash, answerHash, legacyAnswerHash)
      // Re-enroll: salva resposta digitada para que próximo login use múltipla escolha
      // (perguntas são salvas pelo store a partir do response do auth-login)
      if (secOptions.length === 0) {
        authService.saveSecurityAnswers([normalizedAnswer]).catch(() => {})
      }
      router.replace('/(app)/')
    } catch (e: unknown) {
      setIsLoggingIn(false)
      const code = e instanceof authService.BffError ? e.code : 'UNKNOWN'
      if (code === 'TOO_MANY_ATTEMPTS') {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorRateLimit'))
        setPhase('id')
      } else if (code === 'PIN_SETUP_REQUIRED') {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.pinSetupRequired'), [
          {
            text: 'OK',
            onPress: () => {
              pinErrKey.current++
              setPinHash('')
              setPinError(null)
              setPinMode('setup')
              setPhase('pin')
            },
          },
        ])
      } else if (code === 'INVALID_CREDENTIALS') {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorInvalid'))
        pinErrKey.current++
        setPinError(t('auth.login.errorInvalid'))
        setPhase('pin')
      } else {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorGeneric'))
      }
    }
  }

  // Seleção de opção no novo fluxo de múltipla escolha
  const handleOptionPress = (opt: SecurityOption) => {
    if (isLoggingIn) return
    if (!opt.isReal) {
      setWrongChoice(true)
      setTimeout(() => setWrongChoice(false), 1800)
      return
    }
    submitSecurityAnswer(opt.text)
  }

  const handleSecurityConfirm = () => {
    if (answer.trim().length < 2) return
    submitSecurityAnswer(normalizeSecurityAnswer(answer))
  }

  // ─── Fase: identifier ────────────────────────────────────────────────────
  if (phase === 'id') {
    return (
      <KeyboardAvoidingView
        style={[styles.root, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.idContent, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.topHeader}>{t('auth.login.header')}</Text>

          <View style={styles.logoBlock}>
            <AlberLogo size={64} color="#FFFFFF" />
            <Text style={styles.usealber}>{t('auth.login.usealber')}</Text>
          </View>

          <Text style={styles.h1}>{t('auth.login.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.login.subtitle')}</Text>

          <Field
            label={t('auth.login.identifierLabel')}
            value={identifier}
            onChangeText={handleIdentifierChange}
            placeholder={t('auth.login.identifierPlaceholder')}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.spacer} />

          <PrimaryButton
            label={t('auth.login.continue')}
            onPress={() => setPhase('pin')}
            state={isValid ? 'default' : 'disabled'}
          />

          <TouchableOpacity onPress={() => router.push('/(auth)/cadastro/dados')} style={styles.signupLink}>
            <Text style={styles.signupText}>
              {t('auth.login.noAccount')}{' '}
              <Text style={styles.signupCta}>{t('auth.login.signup')}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  // ─── Fase: PIN ──────────────────────────────────────────────────────────
  if (phase === 'pin') {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <TouchableOpacity style={styles.backBtnAbs} onPress={() => { setPinMode('secure'); setPhase('id') }}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>

        <View style={styles.pinContent}>
          <Text style={styles.pinEyebrow}>{t('auth.login.usealber')}</Text>
          <Text style={styles.pinTitle}>{t('auth.login.pinTitle')}</Text>
          <Text style={styles.pinIdentifier}>{identifier}</Text>

          <PINInput
            key={`login-pin-${pinErrKey.current}`}
            onComplete={handlePINComplete}
            mode={pinMode}
            legacyCompat={pinMode === 'setup'}
            error={pinError}
          />

          <TouchableOpacity
            onPress={() => router.push('/(auth)/recuperar/seguranca')}
            style={styles.forgotLink}
          >
            <Text style={styles.forgotText}>{t('auth.login.forgotPin')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ─── Fase: Pergunta de segurança ─────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.secContent, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.backBtnAbs} onPress={() => setPhase('pin')}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>

        <Text style={styles.secEyebrow}>{t('auth.login.securityQuestionLabel')}</Text>

        {secLoading ? (
          <ActivityIndicator color="rgba(255,255,255,0.4)" style={{ marginTop: spacing.xl * 2 }} />
        ) : secOptions.length > 0 ? (
          /* Múltipla escolha: SecureStore tem respostas cadastradas */
          <>
            <Text style={styles.secQuestion}>{question}</Text>
            <Text style={styles.secHint}>{t('auth.login.securityChooseHint')}</Text>
            <View style={styles.optionsList}>
              {secOptions.map((opt, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.optionItem, isLoggingIn && styles.optionDisabled]}
                  onPress={() => handleOptionPress(opt)}
                  activeOpacity={0.65}
                  disabled={isLoggingIn}
                >
                  <Text style={styles.optionText}>{opt.masked}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {wrongChoice && (
              <Text style={styles.wrongChoiceText}>{t('auth.login.securityWrongChoice')}</Text>
            )}
            {isLoggingIn && (
              <Text style={styles.secHint}>{t('common.verifying')}</Text>
            )}
          </>
        ) : (
          /* Fallback texto: SecureStore sem dados locais (ex: novo dispositivo) */
          <>
            {!!question && <Text style={styles.secQuestion}>{question}</Text>}
            <TextInput
              style={styles.secInput}
              value={answer}
              onChangeText={setAnswer}
              placeholder={t('auth.login.securityAnswerPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <Text style={styles.secHint}>{t('auth.login.securityHint')}</Text>
            <View style={styles.spacer} />
            <PrimaryButton
              label={t('auth.login.securityConfirm')}
              onPress={handleSecurityConfirm}
              state={
                isLoggingIn              ? 'loading'  :
                answer.trim().length < 2 ? 'disabled' : 'default'
              }
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[90],
  },
  // id phase
  idContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.sm,
  },
  backBtn: {
    alignSelf: 'flex-start',
    padding: 8,
    marginLeft: -8,
    marginBottom: 4,
  },
  topHeader: {
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.18 * 11,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: spacing.xxl + 2,
    gap: spacing.sm,
  },
  usealber: {
    fontSize: 10,
    letterSpacing: 0.28 * 10,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
  },
  h1: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 24,
    fontFamily: typography.fontFamily.primary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 19,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.xl,
  },
  spacer: { flex: 1, minHeight: spacing.xl },
  signupLink: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  signupText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
  },
  signupCta: {
    color: colors.white[100],
    fontWeight: '600',
  },
  // pin phase
  backBtnAbs: {
    position: 'absolute',
    top: 54,
    left: 16,
    padding: 8,
    zIndex: 10,
  },
  pinContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 54,
    justifyContent: 'center',
  },
  pinEyebrow: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    textAlign: 'center',
    fontFamily: typography.fontFamily.primary,
    marginBottom: 5,
    marginTop: spacing.xl,
  },
  pinTitle: {
    fontSize: typography.size.h1.fontSize,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 22,
    textAlign: 'center',
    fontFamily: typography.fontFamily.primary,
    marginBottom: 6,
  },
  pinIdentifier: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  forgotLink: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  forgotText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textDecorationLine: 'underline',
    fontFamily: typography.fontFamily.primary,
  },
  // security phase
  secContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg + 4,
    paddingTop: 54 + spacing.xl,
  },
  secEyebrow: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  secQuestion: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 20,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.xl,
    lineHeight: 26,
  },
  secInput: {
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: spacing.radius.md,
    paddingHorizontal: spacing.md,
    color: colors.white[100],
    fontSize: 16,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  secHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  backArrow: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 30,
  },
  // security — multiple choice
  optionsList: {
    gap: 10,
    marginTop: 4,
  },
  optionItem: {
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionText: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 1.5,
  },
  wrongChoiceText: {
    fontSize: 13,
    color: colors.state.error,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontFamily: typography.fontFamily.primary,
  },
})
