// Design: /design/auth-login.jsx — LoginFlow
// Spec: /specs/06_modules/onboarding.md seção 5 — login de retorno
// 3 fases: id → pin → security
// Sessão válida < 5min background → Home direto (verificado na Splash)

import { useRef, useState } from 'react'
import {
  Image,
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
import { PINInput } from '../../components/financial/PINInput'
import { SecurityConfirmation, MOCK_SECURITY_QUESTIONS } from '../../components/financial/SecurityConfirmation'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { Field } from '../../components/core/Field'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

type Phase = 'id' | 'pin' | 'security'

function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}

export default function LoginScreen() {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  const [phase, setPhase] = useState<Phase>('id')
  const [identifier, setIdentifier] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const pinErrKey = useRef(0)

  const isHandle = identifier.startsWith('@') || /^[a-z_]/i.test(identifier)
  const isValid = isHandle
    ? identifier.replace(/^@/, '').length >= 3
    : identifier.replace(/\D/g, '').length === 11

  const handleIdentifierChange = (v: string) => {
    if (v.startsWith('@') || /^[a-z_]/i.test(v)) {
      setIdentifier(v.toLowerCase().replace(/[^a-z0-9_@]/g, ''))
    } else if (/^\d/.test(v)) {
      setIdentifier(maskCPF(v))
    } else {
      setIdentifier(v)
    }
  }

  const handlePINComplete = (_hash: string) => {
    // Mock: aceita qualquer PIN correto (hash seria validado no backend)
    setPinError(null)
    setTimeout(() => setPhase('security'), 200)
  }

  const handleSecurityPass = () => {
    // Production: armazenar JWT em SecureStore aqui
    router.replace('/(app)/')
  }

  const handleSecurityBlocked = () => {
    setPinError(t('auth.security.blocked'))
    setPhase('id')
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
          {/* Back */}
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.topHeader}>{t('auth.login.header')}</Text>

          {/* Logo */}
          <View style={styles.logoBlock}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
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
        <TouchableOpacity style={styles.backBtnAbs} onPress={() => setPhase('id')}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>

        <View style={styles.pinContent}>
          <Text style={styles.pinEyebrow}>{t('auth.login.usealber')}</Text>
          <Text style={styles.pinTitle}>{t('auth.login.pinTitle')}</Text>
          <Text style={styles.pinIdentifier}>{identifier}</Text>

          <PINInput
            key={`login-pin-${pinErrKey.current}`}
            onComplete={handlePINComplete}
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

  // ─── Fase: Security confirmation ────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <TouchableOpacity style={styles.cancelBtn} onPress={() => setPhase('pin')}>
        <Text style={styles.cancelText}>{t('auth.security.cancel')}</Text>
      </TouchableOpacity>

      <View style={styles.secContent}>
        <SecurityConfirmation
          questions={MOCK_SECURITY_QUESTIONS}
          onPass={handleSecurityPass}
          onBlocked={handleSecurityBlocked}
        />
      </View>
    </View>
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
  logo: { width: 48, height: 48 },
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
  cancelBtn: {
    position: 'absolute',
    top: 54,
    right: 24,
    zIndex: 10,
    padding: 8,
  },
  cancelText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
  },
  secContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 54 + spacing.xl,
  },
  backArrow: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 30,
  },
})
