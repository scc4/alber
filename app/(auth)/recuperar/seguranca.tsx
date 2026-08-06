// Design: /design/auth-login.jsx — ForgotPinFlow step 0 (id) + step 1 (security)
// Spec: /specs/05_security.md seção 5 — fluxo "Esqueci meu PIN"
// Etapa 1: informar CPF/@handle → validar pergunta de segurança

import { useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { SecurityConfirmation, MOCK_SECURITY_QUESTIONS } from '../../../components/financial/SecurityConfirmation'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { Field } from '../../../components/core/Field'
import { useRecoveryStore } from '../../../store/recovery.store'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type Phase = 'identifier' | 'question'

function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}

function ForgotShell({
  step,
  title,
  subtitle,
  onBack,
  children,
  footer,
}: {
  step: number
  title: string
  subtitle?: string
  onBack: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  return (
    <View style={[shell.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={shell.topNav}>
        <TouchableOpacity onPress={onBack} style={shell.backBtn}>
          <Text style={shell.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={shell.header}>{t('auth.recovery.header')}</Text>
        <View style={shell.backBtn} />
      </View>
      <KeyboardAvoidingView
        style={shell.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Progress */}
        <View style={shell.progress}>
          {[0,1,2,3].map(i => (
            <View key={i} style={[
              shell.seg,
              i < step ? shell.segDone : i === step ? shell.segActive : shell.segTodo,
            ]} />
          ))}
        </View>
        <Text style={shell.title}>{title}</Text>
        {subtitle ? <Text style={shell.subtitle}>{subtitle}</Text> : null}
        <View style={shell.body}>{children}</View>
        {footer ? <View style={shell.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </View>
  )
}

export default function RecuperarSegurancaScreen() {
  const { t } = useTranslation()
  const setRecoveryIdentifier = useRecoveryStore(s => s.setIdentifier)
  const [phase, setPhase] = useState<Phase>('identifier')
  const [identifier, setIdentifier] = useState('')

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

  if (phase === 'identifier') {
    return (
      <ForgotShell
        step={0}
        title={t('auth.recovery.step0.title')}
        subtitle={t('auth.recovery.step0.subtitle')}
        onBack={() => router.back()}
        footer={
          <PrimaryButton
            label={t('auth.onboarding.continue')}
            onPress={() => setPhase('question')}
            state={isValid ? 'default' : 'disabled'}
          />
        }
      >
        <Field
          label={t('auth.login.identifierLabel')}
          value={identifier}
          onChangeText={handleIdentifierChange}
          placeholder={t('auth.login.identifierPlaceholder')}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
        />
      </ForgotShell>
    )
  }

  return (
    <ForgotShell
      step={1}
      title={t('auth.recovery.step1.title')}
      onBack={() => setPhase('identifier')}
    >
      <SecurityConfirmation
        questions={MOCK_SECURITY_QUESTIONS}
        onPass={() => {
          setRecoveryIdentifier(identifier)
          router.push('/(auth)/recuperar/codigo')
        }}
        onBlocked={() => router.replace('/(auth)/login')}
      />
    </ForgotShell>
  )
}

// ─── Styles ForgotShell ───────────────────────────────────────────────────────

const shell = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 36,
    alignItems: 'flex-start',
  },
  backArrow: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 30,
  },
  header: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.18 * 11,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  progress: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 18,
  },
  seg: { height: 3, flex: 1, borderRadius: 2 },
  segDone:   { backgroundColor: colors.white[100] },
  segActive: { backgroundColor: 'rgba(255,255,255,0.45)' },
  segTodo:   { backgroundColor: 'rgba(255,255,255,0.10)' },
  title: {
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
    marginBottom: spacing.lg,
  },
  body: {
    flex: 1,
  },
  footer: {
    paddingVertical: spacing.md,
    paddingBottom: spacing.lg,
  },
})
