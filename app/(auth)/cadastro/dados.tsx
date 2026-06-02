// Design: /design/auth.jsx — StepPersonal
// Spec: /specs/06_modules/onboarding.md seção 3.3

import { useState } from 'react'
import { TouchableOpacity, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { AlertCard } from '../../../components/core/AlertCard'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { DatePickerField, formatDateBR } from '../../../components/shared/DatePickerField'
import { updateDraft } from '../../../store/signup-draft'
import { validateCPF } from '../../../utils/cpf'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

// ─── Máscaras ────────────────────────────────────────────────────────────────
function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}
function maskPhone(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 10) return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`
  if (v.length > 6)  return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`
  if (v.length > 2)  return `(${v.slice(0,2)}) ${v.slice(2)}`
  return v
}

// Limite de 18 anos: hoje menos 18 anos
function maxBirthDate(): Date {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 18)
  return d
}

const MOCK_DUPLICATE_CPF = '11111111111'

export default function DadosScreen() {
  const { t } = useTranslation()

  const [name, setName]       = useState('')
  const [cpf, setCpf]         = useState('')
  const [birthDate, setBirth] = useState<Date | null>(null)
  const [email, setEmail]     = useState('')
  const [phone, setPhone]     = useState('')
  const [touched, setTouch]   = useState<Record<string, boolean>>({})

  const touch = (field: string) => setTouch(t => ({ ...t, [field]: true }))

  const cpfDigits  = cpf.replace(/\D/g, '')
  const cpfValid   = validateCPF(cpf)

  const birth = birthDate ? formatDateBR(birthDate) : ''

  const errors = {
    name:  name && name.trim().split(/\s+/).length < 2 ? t('auth.onboarding.dados.nameError') : null,
    cpf:   cpfDigits.length === 11 && !cpfValid ? t('auth.onboarding.dados.cpfError') : null,
    email: email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? t('auth.onboarding.dados.emailError') : null,
    phone: phone && phone.replace(/\D/g,'').length < 11 ? t('auth.onboarding.dados.phoneError') : null,
  }

  const isDuplicate = cpfValid && cpfDigits === MOCK_DUPLICATE_CPF

  const isReady =
    name.trim().split(/\s+/).length >= 2 &&
    cpfValid &&
    birthDate !== null &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    phone.replace(/\D/g,'').length === 11 &&
    !isDuplicate

  const handleNext = () => {
    updateDraft({ name, cpf, birth, email, phone })
    router.push('/(auth)/cadastro/endereco')
  }

  return (
    <OnboardShell
      step={0}
      title={t('auth.onboarding.dados.title')}
      subtitle={t('auth.onboarding.dados.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={isReady ? 'default' : 'disabled'}
        />
      }
    >
      <Field
        label={t('auth.onboarding.dados.name')}
        value={name}
        onChangeText={setName}
        placeholder={t('auth.onboarding.dados.namePlaceholder')}
        autoFocus
        onBlur={() => touch('name')}
        error={touched.name ? errors.name : null}
      />

      <Field
        label={t('auth.onboarding.dados.cpf')}
        value={cpf}
        onChangeText={v => {
          const masked = maskCPF(v)
          setCpf(masked)
          if (masked.replace(/\D/g, '').length === 11) touch('cpf')
        }}
        placeholder={t('auth.onboarding.dados.cpfPlaceholder')}
        keyboardType="numeric"
        onBlur={() => touch('cpf')}
        error={touched.cpf ? errors.cpf : null}
      />

      {isDuplicate && (
        <View style={styles.dupGap}>
          <AlertCard
            tone="warning"
            text={t('auth.onboarding.dados.cpfDuplicate')}
            cta={t('auth.onboarding.dados.cpfDuplicateCta')}
            onPress={() => router.replace('/(auth)/recuperar/seguranca')}
          />
        </View>
      )}

      <DatePickerField
        label={t('auth.onboarding.dados.birth')}
        value={birthDate}
        onChange={d => { setBirth(d); touch('birth') }}
        maximumDate={maxBirthDate()}
        hint={t('auth.onboarding.dados.birthHint')}
      />

      <Field
        label={t('auth.onboarding.dados.email')}
        value={email}
        onChangeText={v => setEmail(v.toLowerCase())}
        placeholder={t('auth.onboarding.dados.emailPlaceholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        onBlur={() => touch('email')}
        error={touched.email ? errors.email : null}
      />

      <Field
        label={t('auth.onboarding.dados.phone')}
        value={phone}
        onChangeText={v => setPhone(maskPhone(v))}
        placeholder={t('auth.onboarding.dados.phonePlaceholder')}
        keyboardType="phone-pad"
        onBlur={() => touch('phone')}
        error={touched.phone ? errors.phone : null}
      />
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  dupGap: {
    marginTop: -10,
    marginBottom: 18,
  },
})
