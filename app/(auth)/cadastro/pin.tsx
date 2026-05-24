// Design: /design/auth.jsx — StepPin
// Spec: /specs/06_modules/onboarding.md seção 3.6 + /specs/05_security.md seção 2
// CRÍTICO: teclado scrambled, screenshot bloqueada, confirmação obrigatória
// PIN nunca trafega em texto puro — apenas hash SHA-256

import { useState, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { PINInput } from '../../../components/financial/PINInput'
import { updateDraft } from '../../../store/signup-draft'

type Phase = 'create' | 'confirm'

export default function PinScreen() {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('create')
  const [firstHash, setFirstHash] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const errorKey = useRef(0)

  const handleCreate = (hash: string) => {
    setFirstHash(hash)
    setError(null)
    setTimeout(() => setPhase('confirm'), 200)
  }

  const handleConfirm = (hash: string) => {
    if (hash === firstHash) {
      updateDraft({ pinHash: hash })
      router.push('/(auth)/cadastro/seguranca')
    } else {
      errorKey.current++
      setError(t('auth.onboarding.pin.mismatch'))
      setTimeout(() => {
        setPhase('create')
        setFirstHash('')
        setError(null)
      }, 1600)
    }
  }

  const handleObvious = () => {
    errorKey.current++
    setError(t('auth.onboarding.pin.obvious'))
    // PINInput já limpa internamente após 350ms
  }

  const handleBack = () => {
    if (phase === 'confirm') {
      setPhase('create')
      setFirstHash('')
      setError(null)
    } else {
      router.back()
    }
  }

  const isCreate = phase === 'create'

  return (
    <OnboardShell
      step={3}
      title={t(isCreate ? 'auth.onboarding.pin.create.title' : 'auth.onboarding.pin.confirm.title')}
      subtitle={t(isCreate ? 'auth.onboarding.pin.create.subtitle' : 'auth.onboarding.pin.confirm.subtitle')}
      onBack={handleBack}
    >
      <View style={styles.inputArea}>
        {/* key força remount e reshuffle das posições ao trocar de fase */}
        <PINInput
          key={`${phase}-${errorKey.current}`}
          onComplete={isCreate ? handleCreate : handleConfirm}
          checkObvious={isCreate}
          onObvious={handleObvious}
          error={error}
        />
      </View>
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  inputArea: {
    flex: 1,
    paddingTop: 8,
  },
})
