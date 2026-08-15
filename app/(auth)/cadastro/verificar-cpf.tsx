// Melhoria 1 (cadastro de empresa para quem já tem conta pessoal)
// Primeiro passo do cadastro de empresa: pede o CPF do responsável e checa se
// já existe conta ativa. Se existir, pede PIN + pergunta de segurança (login
// normal) e pula direto para os dados da empresa — evita forçar um cadastro
// pessoal novo que sempre esbarrava em CPF_DUPLICATE/EMAIL_IN_USE.

import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { PINInput } from '../../../components/financial/PINInput'
import { SecurityConfirmation } from '../../../components/financial/SecurityConfirmation'
import { validateCPF } from '../../../utils/cpf'
import { formatDateTime } from '../../../utils/format'
import { useAuthStore } from '../../../store/auth.store'
import { updateDraft } from '../../../store/signup-draft'
import * as authService from '../../../services/auth.service'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type Phase = 'cpf' | 'pin' | 'security'

function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}

export default function VerificarCpfScreen() {
  const { t }  = useTranslation()
  const login  = useAuthStore(s => s.login)

  const [phase, setPhase]       = useState<Phase>('cpf')
  const [cpf, setCpf]           = useState('')
  const [checking, setChecking] = useState(false)
  const [cpfError, setCpfError] = useState<string | null>(null)
  const [pinHash, setPinHash]   = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [wrongAnswer, setWrongAnswer] = useState(false)

  const cpfDigits = cpf.replace(/\D/g, '')
  const cpfValid  = validateCPF(cpf)

  const handleCheckCpf = async () => {
    if (!cpfValid || checking) return
    setChecking(true)
    setCpfError(null)
    try {
      const exists = await authService.checkCpfExists(cpfDigits)
      if (exists) {
        setPhase('pin')
      } else {
        updateDraft({ cpf })
        router.push('/(auth)/cadastro/dados')
      }
    } catch {
      setCpfError(t('auth.onboarding.verificarCpf.errorGeneric'))
    } finally {
      setChecking(false)
    }
  }

  const handlePinComplete = (hash: string) => {
    setPinHash(hash)
    setPinError(null)
    setPhase('security')
  }

  const handleSecurityPass = async (answerHash: string) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await login(cpfDigits, pinHash, answerHash)
      updateDraft({ existingAccountFlow: true })
      router.push('/(auth)/cadastro/dados-empresa')
    } catch (e: unknown) {
      setSubmitting(false)
      const isBff = e instanceof authService.BffError
      const code  = isBff ? e.code : 'UNKNOWN'

      if (code === 'WRONG_SECURITY_ANSWER') {
        setWrongAnswer(true)
        setTimeout(() => setWrongAnswer(false), 1800)
      } else if (code === 'ACCOUNT_BLOCKED') {
        const blockedUntil = isBff ? e.extra.blocked_until as string | undefined : undefined
        Alert.alert(
          t('auth.onboarding.verificarCpf.accountBlockedTitle'),
          t('auth.onboarding.verificarCpf.accountBlockedMessage', { time: blockedUntil ? formatDateTime(blockedUntil) : '' }),
        )
        setPhase('cpf')
      } else {
        Alert.alert(t('auth.onboarding.verificarCpf.invalidTitle'), t('auth.onboarding.verificarCpf.invalidMessage'))
        setPinHash('')
        setPhase('pin')
      }
    }
  }

  const handlePinInvalid = () => {
    setPinHash('')
    setPinError(t('auth.onboarding.verificarCpf.invalidMessage'))
    setPhase('pin')
  }

  const handleBlocked = (blockedUntil: string) => {
    Alert.alert(
      t('auth.onboarding.verificarCpf.accountBlockedTitle'),
      t('auth.onboarding.verificarCpf.accountBlockedMessage', { time: formatDateTime(blockedUntil) }),
    )
    setPhase('cpf')
  }

  if (phase === 'pin') {
    return (
      <View style={styles.pinRoot}>
        <View style={styles.pinContent}>
          <Text style={styles.pinEyebrow}>{t('auth.onboarding.verificarCpf.foundTitle')}</Text>
          <Text style={styles.pinTitle}>{t('auth.onboarding.verificarCpf.pinTitle')}</Text>
          <PINInput mode="secure" onComplete={handlePinComplete} error={pinError} checkObvious={false} />
        </View>
      </View>
    )
  }

  if (phase === 'security') {
    return (
      <View style={styles.securityRoot}>
        <SecurityConfirmation
          identifier={cpfDigits}
          pinHash={pinHash}
          eyebrow={t('auth.onboarding.verificarCpf.foundTitle')}
          submitting={submitting}
          wrongAnswer={wrongAnswer}
          onPass={handleSecurityPass}
          onPinInvalid={handlePinInvalid}
          onBlocked={handleBlocked}
        />
      </View>
    )
  }

  return (
    <OnboardShell
      step={0}
      hideProgress
      title={t('auth.onboarding.verificarCpf.title')}
      subtitle={t('auth.onboarding.verificarCpf.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleCheckCpf}
          state={!cpfValid ? 'disabled' : checking ? 'loading' : 'default'}
        />
      }
    >
      <Field
        label={t('auth.onboarding.verificarCpf.cpf')}
        value={cpf}
        onChangeText={v => { setCpf(maskCPF(v)); setCpfError(null) }}
        placeholder={t('auth.onboarding.verificarCpf.cpfPlaceholder')}
        keyboardType="numeric"
        autoFocus
        loading={checking}
        error={cpfError}
      />
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  pinRoot: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  pinContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 80,
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
  },
  pinTitle: {
    fontSize: typography.size.h1.fontSize,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 22,
    textAlign: 'center',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  securityRoot: {
    flex: 1,
    backgroundColor: colors.black[100],
    paddingHorizontal: spacing.lg,
    paddingTop: 80,
  },
})
