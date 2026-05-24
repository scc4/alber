// Design: /design/auth-login.jsx — ForgotPinFlow step 3 (novo PIN) + step 4 (success)
// Spec: /specs/05_security.md seção 5 — PIN atualizado + todas as sessões invalidadas

import { useRef, useState } from 'react'
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { PINInput } from '../../../components/financial/PINInput'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type Phase = 'create' | 'confirm' | 'success'

function ForgotShell({
  step, title, subtitle, onBack, children,
}: {
  step: number; title: string; subtitle?: string
  onBack: () => void; children: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.nav}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={s.header}>{t('auth.recovery.header')}</Text>
        <View style={s.backBtn} />
      </View>
      <View style={s.content}>
        <View style={s.progress}>
          {[0,1,2,3].map(i => (
            <View key={i} style={[s.seg, i < step ? s.done : i === step ? s.active : s.todo]} />
          ))}
        </View>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        {children}
      </View>
    </View>
  )
}

export default function NovoPinScreen() {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const [phase, setPhase] = useState<Phase>('create')
  const [firstHash, setFirstHash] = useState('')
  const [error, setError] = useState<string | null>(null)
  const errKey = useRef(0)

  const handleCreate = (hash: string) => {
    setFirstHash(hash)
    setTimeout(() => setPhase('confirm'), 200)
  }

  const handleConfirm = (hash: string) => {
    if (hash === firstHash) {
      // Production: enviar novo hash ao backend + invalidar sessões
      setPhase('success')
    } else {
      errKey.current++
      setError(t('auth.onboarding.pin.mismatch'))
      setTimeout(() => {
        setPhase('create')
        setFirstHash('')
        setError(null)
      }, 1600)
    }
  }

  const handleObvious = () => {
    errKey.current++
    setError(t('auth.onboarding.pin.obvious'))
  }

  if (phase === 'success') {
    return (
      <View style={[s.root, s.successRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.successCenter}>
          <View style={s.successIcon}>
            <Text style={s.successCheck}>✓</Text>
          </View>
          <Text style={s.successTitle}>{t('auth.recovery.success.title')}</Text>
          <Text style={s.successBody}>{t('auth.recovery.success.body')}</Text>
        </View>
        <View style={s.successFooter}>
          <PrimaryButton
            label={t('auth.recovery.success.cta')}
            onPress={() => router.replace('/(auth)/login')}
          />
        </View>
      </View>
    )
  }

  const isCreate = phase === 'create'
  return (
    <ForgotShell
      step={3}
      title={t(isCreate ? 'auth.recovery.step3Create.title' : 'auth.recovery.step3Confirm.title')}
      subtitle={t(isCreate ? 'auth.recovery.step3Create.subtitle' : 'auth.recovery.step3Confirm.subtitle')}
      onBack={() => {
        if (phase === 'confirm') { setPhase('create'); setFirstHash('') }
        else router.back()
      }}
    >
      <PINInput
        key={`recovery-${phase}-${errKey.current}`}
        onComplete={isCreate ? handleCreate : handleConfirm}
        checkObvious={isCreate}
        onObvious={handleObvious}
        error={error}
      />
    </ForgotShell>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backBtn: { width: 36, alignItems: 'flex-start' },
  backArrow: { fontSize: 28, color: 'rgba(255,255,255,0.85)', lineHeight: 30 },
  header: {
    flex: 1, textAlign: 'center', fontSize: 11,
    color: 'rgba(255,255,255,0.4)', letterSpacing: 0.18 * 11,
    textTransform: 'uppercase', fontFamily: typography.fontFamily.primary,
  },
  content: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  progress: { flexDirection: 'row', gap: 6, marginBottom: 18 },
  seg: { height: 3, flex: 1, borderRadius: 2 },
  done:   { backgroundColor: colors.white[100] },
  active: { backgroundColor: 'rgba(255,255,255,0.45)' },
  todo:   { backgroundColor: 'rgba(255,255,255,0.10)' },
  title: {
    fontSize: 24, fontWeight: '600', color: colors.white[100],
    letterSpacing: -0.02 * 24, fontFamily: typography.fontFamily.primary, marginBottom: 6,
  },
  subtitle: {
    fontSize: 13.5, color: 'rgba(255,255,255,0.55)', lineHeight: 19,
    fontFamily: typography.fontFamily.primary, marginBottom: spacing.lg,
  },
  // success
  successRoot: { justifyContent: 'space-between' },
  successCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  successIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 0.5, borderColor: 'rgba(34,197,94,0.4)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successCheck: { fontSize: 28, color: colors.state.success },
  successTitle: {
    fontSize: typography.size.h1.fontSize, fontWeight: '600',
    color: colors.white[100], letterSpacing: -0.02 * 22,
    textAlign: 'center', fontFamily: typography.fontFamily.primary,
    marginBottom: 10,
  },
  successBody: {
    fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 20,
    textAlign: 'center', fontFamily: typography.fontFamily.primary,
  },
  successFooter: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
})
