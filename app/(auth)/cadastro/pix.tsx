// Design: /design/auth.jsx — StepPix
// Spec: /specs/06_modules/onboarding.md seção 3.8
// Spec: /specs/03_backend.md §4.1
// Último passo do cadastro — chama auth-register e inicia sessão

import { useEffect, useRef, useState } from 'react'
import { Alert, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { getDraft, clearDraft } from '../../../store/signup-draft'
import { useAuthStore } from '../../../store/auth.store'
import * as authService from '../../../services/auth.service'
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

// DD/MM/YYYY → YYYY-MM-DD
function parseBirthDate(dmy: string): string {
  const [d, m, y] = dmy.split('/')
  return `${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}`
}

const PIX_TYPES: { id: PixType; labelKey: string }[] = [
  { id: 'cpf',    labelKey: 'auth.onboarding.pix.cpf' },
  { id: 'phone',  labelKey: 'auth.onboarding.pix.phone' },
  { id: 'email',  labelKey: 'auth.onboarding.pix.email' },
  { id: 'random', labelKey: 'auth.onboarding.pix.random' },
]

const CREATING_STEPS_KEYS = [
  'auth.onboarding.creating.step1',
  'auth.onboarding.creating.step2',
  'auth.onboarding.creating.step3',
  'auth.onboarding.creating.step4',
]

// ── Tela de criação em progresso ──────────────────────────────────────────────

function CreatingScreen({ step }: { step: number }) {
  const { t } = useTranslation()
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start()
    return () => { opacity.setValue(0) }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={creating.root}>
      <View style={creating.center}>
        <View style={creating.dotsRow}>
          {CREATING_STEPS_KEYS.map((_, i) => (
            <View
              key={i}
              style={[creating.dot, i <= step ? creating.dotActive : creating.dotIdle]}
            />
          ))}
        </View>
        <Animated.Text style={[creating.label, { opacity }]}>
          {t(CREATING_STEPS_KEYS[step] ?? CREATING_STEPS_KEYS[0])}
        </Animated.Text>
      </View>
    </View>
  )
}

// ── Tela principal ────────────────────────────────────────────────────────────

export default function PixScreen() {
  const { t }        = useTranslation()
  const setSession   = useAuthStore(s => s.setSession)
  const draft        = getDraft()

  const [pixType, setPixType]       = useState<PixType>('cpf')
  const [pixKey, setPixKey]         = useState<string>(draft.cpf ?? '')
  const [isCreating, setIsCreating] = useState(false)
  const [creatingStep, setCreatingStep] = useState(0)

  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const switchType = (type: PixType) => {
    setPixType(type)
    switch (type) {
      case 'cpf':    setPixKey(draft.cpf ?? ''); break
      case 'phone':  setPixKey(draft.phone ?? ''); break
      case 'email':  setPixKey(draft.email ?? ''); break
      case 'random': setPixKey(generateUUID()); break
    }
  }

  useEffect(() => {
    if (pixType === 'random' && !pixKey) setPixKey(generateUUID())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isCreating) {
      setCreatingStep(0)
      stepTimer.current = setInterval(() => {
        setCreatingStep(s => Math.min(s + 1, CREATING_STEPS_KEYS.length - 1))
      }, 1400)
    } else {
      if (stepTimer.current) clearInterval(stepTimer.current)
    }
    return () => { if (stepTimer.current) clearInterval(stepTimer.current) }
  }, [isCreating])

  const isReady = pixKey.trim().length > 0

  const handleNext = async () => {
    if (!isReady || isCreating) return

    // Validação mínima antes de chamar o backend
    const d = getDraft()
    if (!d.name || !d.cpf || !d.birth || !d.email || !d.phone ||
        !d.pinHash || !d.security?.length || !d.handle) {
      Alert.alert(t('auth.onboarding.pix.errorTitle'), t('auth.onboarding.pix.errorGeneric'))
      return
    }

    setIsCreating(true)

    try {
      const input: authService.RegisterInput = {
        name:       d.name,
        email:      d.email,
        cpf:        d.cpf.replace(/\D/g, ''),
        birth_date: parseBirthDate(d.birth),
        phone:      d.phone.replace(/\D/g, ''),
        address: {
          street:       d.street ?? '',
          number:       d.number ?? 'S/N',
          complement:   d.complement || undefined,
          neighborhood: d.neighborhood ?? '',
          zip_code:     (d.cep ?? '').replace(/\D/g, ''),
          city:         d.city ?? '',
          state:        d.state ?? '',
        },
        handle:             d.handle.replace(/^@/, ''),
        pin_hash:           d.pinHash,
        security_questions: d.security.map(q => ({
          question:    q.question,
          answer_hash: q.answerHash,
        })),
        pix_key:      pixKey,
        pix_key_type: pixType,
        terms_accepted: true,
      }

      const res = await authService.register(input)

      // Persiste textos das perguntas para a tela de login
      await authService.saveSecurityQuestions(d.security.map(q => q.question))

      await setSession(
        res.token,
        res.refresh_token,
        {
          id:           res.user_id,
          name:         d.name,
          handle:       `@${input.handle}`,
          email:        d.email,
          cpfMasked:    '',
          pixKey:       '',
          pixKeyType:   pixType,
        },
        res.kyc_status as 'pending' | 'submitted' | 'approved' | 'rejected',
        res.account_status as 'active' | 'evaluation' | 'blocked',
      )

      clearDraft()
      router.replace('/(app)/')
    } catch (e: unknown) {
      console.log('[pix.register] caught error:', e)
      setIsCreating(false)

      const isBff = e instanceof authService.BffError
      const code  = isBff ? e.code    : 'UNKNOWN'
      const srvMsg = isBff ? e.message : ''
      const title = t('auth.onboarding.pix.errorTitle')

      if (code === 'CPF_DUPLICATE' || code === 'CPF_IN_USE') {
        Alert.alert(
          title,
          'Este CPF já possui uma conta. Recuperar acesso?',
          [
            { text: 'Fechar', style: 'cancel' },
            { text: 'Fazer login', onPress: () => router.replace('/(auth)/login') },
          ],
        )
      } else if (code === 'EMAIL_IN_USE') {
        Alert.alert(
          title,
          'Este e-mail já está em uso. Tente outro e-mail.',
          [{ text: 'OK', onPress: () => router.push('/(auth)/cadastro/dados') }],
        )
      } else if (code === 'HANDLE_TAKEN') {
        Alert.alert(
          title,
          'Este @handle já está em uso. Escolha outro.',
          [{ text: 'OK', onPress: () => router.push('/(auth)/cadastro/handle') }],
        )
      } else if (code === 'ASAAS_ERROR') {
        Alert.alert(title, srvMsg || t('auth.onboarding.pix.errorAsaas'))
      } else {
        Alert.alert(title, t('auth.onboarding.pix.errorGeneric'))
      }
    }
  }

  if (isCreating) return <CreatingScreen step={creatingStep} />

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

// ── Styles ────────────────────────────────────────────────────────────────────

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

const creating = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: { backgroundColor: colors.white[100] },
  dotIdle:   { backgroundColor: 'rgba(255,255,255,0.15)' },
  label: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
    letterSpacing: -0.02 * 17,
  },
})
