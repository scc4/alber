// Design: /design/auth.jsx — StepPix
// Spec: /specs/06_modules/onboarding.md seção 3.8
// 4 tipos de chave. CPF auto-preenchido e read-only. Aleatória gerada automaticamente.
// TODO: após este step → tela de termos (Sprint 1.1). Mock: vai direto para (app)

import { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { getDraft, updateDraft } from '../../../store/signup-draft'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type PixType = 'cpf' | 'phone' | 'email' | 'random'

function maskPhone(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 10) return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`
  if (v.length > 6)  return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`
  if (v.length > 2)  return `(${v.slice(0,2)}) ${v.slice(2)}`
  return v
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const PIX_TYPES: { id: PixType; labelKey: string }[] = [
  { id: 'cpf',    labelKey: 'auth.onboarding.pix.cpf' },
  { id: 'phone',  labelKey: 'auth.onboarding.pix.phone' },
  { id: 'email',  labelKey: 'auth.onboarding.pix.email' },
  { id: 'random', labelKey: 'auth.onboarding.pix.random' },
]

export default function PixScreen() {
  const { t } = useTranslation()
  const draft = getDraft()

  const [pixType, setPixType] = useState<PixType>('cpf')
  const [pixKey, setPixKey]   = useState<string>(draft.cpf ?? '')

  const switchType = (type: PixType) => {
    setPixType(type)
    switch (type) {
      case 'cpf':    setPixKey(draft.cpf ?? ''); break
      case 'phone':  setPixKey(draft.phone ?? ''); break
      case 'email':  setPixKey(draft.email ?? ''); break
      case 'random': setPixKey(generateUUID()); break
    }
  }

  // Garante chave aleatória na primeira renderização se tipo for random
  useEffect(() => {
    if (pixType === 'random' && !pixKey) setPixKey(generateUUID())
  }, [])

  const isReady = pixKey.trim().length > 0

  const handleNext = () => {
    updateDraft({ pixType, pixKey })
    // Mock: pula tela de termos → Home
    // Production: router.push('/(auth)/cadastro/termos')
    router.replace('/(app)/')
  }

  return (
    <OnboardShell
      step={5}
      title={t('auth.onboarding.pix.title')}
      subtitle={t('auth.onboarding.pix.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={isReady ? 'default' : 'disabled'}
        />
      }
    >
      {/* Seletor de tipo */}
      <View style={styles.typeGrid}>
        {PIX_TYPES.map(({ id, labelKey }) => (
          <TouchableOpacity
            key={id}
            style={[styles.typeBtn, pixType === id && styles.typeBtnActive]}
            onPress={() => switchType(id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.typeBtnText, pixType === id && styles.typeBtnTextActive]}>
              {t(labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Campo da chave */}
      {pixType === 'cpf' && (
        <Field
          label={t('auth.onboarding.pix.cpfLabel')}
          value={pixKey}
          editable={false}
          hint={t('auth.onboarding.pix.cpfHint')}
        />
      )}
      {pixType === 'phone' && (
        <Field
          label={t('auth.onboarding.pix.phoneLabel')}
          value={pixKey}
          onChangeText={v => setPixKey(maskPhone(v))}
          keyboardType="phone-pad"
        />
      )}
      {pixType === 'email' && (
        <Field
          label={t('auth.onboarding.pix.emailLabel')}
          value={pixKey}
          onChangeText={v => setPixKey(v.toLowerCase())}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      )}
      {pixType === 'random' && (
        <Field
          label={t('auth.onboarding.pix.randomLabel')}
          value={pixKey}
          editable={false}
          hint={t('auth.onboarding.pix.randomHint')}
        />
      )}
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.lg,
  },
  typeBtn: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
  },
  typeBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.40)',
  },
  typeBtnText: {
    fontSize: 13,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontWeight: '400',
  },
  typeBtnTextActive: {
    fontWeight: '600',
  },
})
