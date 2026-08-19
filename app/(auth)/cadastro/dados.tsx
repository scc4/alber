// Design: /design/auth.jsx — StepPersonal
// Spec: /specs/06_modules/onboarding.md seção 3.3

import { useEffect, useRef, useState } from 'react'
import { TouchableOpacity, StyleSheet, Text } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { DatePickerField, formatDateBR } from '../../../components/shared/DatePickerField'
import { LegalDocModal } from '../../../components/shared/LegalDocModal'
import { getDraft, updateDraft } from '../../../store/signup-draft'
import { validateCPF } from '../../../utils/cpf'
import * as authService from '../../../services/auth.service'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type CpfStatus = 'idle' | 'checking' | 'duplicate'

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

export default function DadosScreen() {
  const { t } = useTranslation()

  // CPF já pode vir preenchido pela checagem prévia do cadastro de empresa
  // (verificar-cpf.tsx, Melhoria 1) — evita digitar de novo o que já foi validado.
  const [name, setName]       = useState('')
  const [cpf, setCpf]         = useState(() => {
    const draftCpf = getDraft().cpf
    return draftCpf ? maskCPF(draftCpf) : ''
  })
  const [birthDate, setBirth] = useState<Date | null>(null)
  const [email, setEmail]     = useState('')
  const [emailConfirm, setEmailConfirm] = useState('')
  const [phone, setPhone]     = useState('')
  const [phoneConfirm, setPhoneConfirm] = useState('')
  const [touched, setTouch]   = useState<Record<string, boolean>>({})
  const [cpfStatus, setCpfStatus] = useState<CpfStatus>('idle')
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const cpfCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const touch = (field: string) => setTouch(t => ({ ...t, [field]: true }))

  const cpfDigits  = cpf.replace(/\D/g, '')
  const cpfValid   = validateCPF(cpf)

  // Duplicidade de CPF (ON-02): checa em tempo real assim que o CPF fica
  // válido, em vez de deixar a pessoa percorrer o cadastro inteiro só pra
  // ser barrada no fim pelo auth-register (CPF_DUPLICATE, tratado em
  // terms.tsx como rede de segurança contra corrida).
  useEffect(() => {
    if (cpfCheckTimer.current) clearTimeout(cpfCheckTimer.current)
    if (!cpfValid) {
      setCpfStatus('idle')
      return
    }
    setCpfStatus('checking')
    cpfCheckTimer.current = setTimeout(async () => {
      try {
        const exists = await authService.checkCpfExists(cpfDigits)
        setCpfStatus(exists ? 'duplicate' : 'idle')
      } catch {
        setCpfStatus('idle')
      }
    }, 500)
    return () => { if (cpfCheckTimer.current) clearTimeout(cpfCheckTimer.current) }
  }, [cpfDigits, cpfValid])

  const birth = birthDate ? formatDateBR(birthDate) : ''

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const phoneComplete = phone.replace(/\D/g,'').length === 11

  const errors = {
    name:  name && name.trim().split(/\s+/).length < 2 ? t('auth.onboarding.dados.nameError') : null,
    cpf:   cpfDigits.length === 11 && !cpfValid ? t('auth.onboarding.dados.cpfError') : null,
    email: email && !emailValid ? t('auth.onboarding.dados.emailError') : null,
    // Confirmação (item 27) — mitigação de baixo custo pra erro de digitação
    // enquanto não há verificação por SMS/e-mail contratada.
    emailConfirm: emailConfirm && emailValid && emailConfirm.toLowerCase() !== email.toLowerCase()
      ? t('auth.onboarding.dados.confirmEmailError') : null,
    phone: phone && phone.replace(/\D/g,'').length < 11 ? t('auth.onboarding.dados.phoneError') : null,
    phoneConfirm: phoneConfirm && phoneComplete && phoneConfirm.replace(/\D/g,'') !== phone.replace(/\D/g,'')
      ? t('auth.onboarding.dados.confirmPhoneError') : null,
  }

  const isReady =
    name.trim().split(/\s+/).length >= 2 &&
    cpfValid &&
    cpfStatus === 'idle' &&
    birthDate !== null &&
    emailValid &&
    emailConfirm.toLowerCase() === email.toLowerCase() &&
    phoneComplete &&
    phoneConfirm.replace(/\D/g,'') === phone.replace(/\D/g,'')

  const handleNext = () => {
    updateDraft({ name, cpf, birth, email, phone })
    router.push('/(auth)/cadastro/endereco')
  }

  return (
    <>
    <OnboardShell
      step={0}
      title={t('auth.onboarding.dados.title')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={isReady ? 'default' : 'disabled'}
        />
      }
    >
      {/* Subtítulo com link para a Política de Privacidade (item 24) — texto
          próprio em vez do subtitle do OnboardShell porque ele só aceita
          string simples, sem trecho clicável aninhado. */}
      <Text style={styles.subtitle}>
        {t('auth.onboarding.dados.subtitle', { link: '' })}
        <Text style={styles.subtitleLink} onPress={() => setPrivacyOpen(true)} suppressHighlighting>
          {t('auth.onboarding.terms.privacyPolicy')}
        </Text>
      </Text>

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
        loading={cpfStatus === 'checking'}
        error={touched.cpf ? errors.cpf : null}
      />
      {touched.cpf && cpfStatus === 'duplicate' && (
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/(auth)/login', params: { cpf: cpfDigits } })}
          style={styles.duplicateBox}
          activeOpacity={0.75}
        >
          <Text style={styles.duplicateBoxText}>
            {t('auth.onboarding.dados.cpfDuplicate')}{' '}
            <Text style={styles.duplicateBoxCta}>{t('auth.onboarding.dados.cpfDuplicateCta')}</Text>
          </Text>
        </TouchableOpacity>
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
        label={t('auth.onboarding.dados.confirmEmail')}
        value={emailConfirm}
        onChangeText={v => setEmailConfirm(v.toLowerCase())}
        placeholder={t('auth.onboarding.dados.confirmEmailPlaceholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        onBlur={() => touch('emailConfirm')}
        error={touched.emailConfirm ? errors.emailConfirm : null}
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

      <Field
        label={t('auth.onboarding.dados.confirmPhone')}
        value={phoneConfirm}
        onChangeText={v => setPhoneConfirm(maskPhone(v))}
        placeholder={t('auth.onboarding.dados.confirmPhonePlaceholder')}
        keyboardType="phone-pad"
        onBlur={() => touch('phoneConfirm')}
        error={touched.phoneConfirm ? errors.phoneConfirm : null}
      />
    </OnboardShell>
    <LegalDocModal
      visible={privacyOpen}
      title={t('auth.onboarding.terms.privacyPolicy')}
      body={t('auth.onboarding.terms.privacyPolicyBody')}
      onClose={() => setPrivacyOpen(false)}
    />
    </>
  )
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 19,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  subtitleLink: {
    color: colors.white[100],
    textDecorationLine: 'underline',
  },
  duplicateBox: {
    marginTop: -10,
    marginBottom: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(245,158,11,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.22)',
    borderRadius: spacing.radius.md,
  },
  duplicateBoxText: {
    fontSize: 12,
    color: colors.warning[500],
    lineHeight: 17,
    fontFamily: typography.fontFamily.primary,
  },
  duplicateBoxCta: {
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
})
