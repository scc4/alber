import React, { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { PINInput } from '../../../components/financial/PINInput'
import {
  SecurityConfirmation,
  MOCK_SECURITY_QUESTIONS,
} from '../../../components/financial/SecurityConfirmation'
import { useAuthStore } from '../../../store/auth.store'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type Step = 'input' | 'pin' | 'security' | 'success'
type Availability = 'idle' | 'checking' | 'available' | 'taken'

// Mudar para true para testar o estado de cooldown
const MOCK_IN_COOLDOWN   = false
const MOCK_COOLDOWN_DATE = '25/jun/2026'

const TAKEN_HANDLES = [
  'joaosilva', 'ana_costa', 'phenrique', 'cami',
  'lucas_f', 'marinasantos', 'rafa', 'beatriz_lima',
]

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps { title: string; onBack: () => void }

function Header({ title, onBack }: HeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.backBtn} />
    </View>
  )
}

// ── StepInput ─────────────────────────────────────────────────────────────────

interface StepInputProps {
  currentHandle: string
  onConfirm: (newHandle: string) => void
}

function StepInput({ currentHandle, onConfirm }: StepInputProps) {
  const { t } = useTranslation()
  const [value, setValue]         = useState('')
  const [avail, setAvail]         = useState<Availability>('idle')
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const clean = value.trim().replace(/^@/, '').toLowerCase()

    if (clean.length < 3) {
      setAvail('idle')
      return
    }

    setAvail('checking')
    debounceRef.current = setTimeout(() => {
      setAvail(TAKEN_HANDLES.includes(clean) ? 'taken' : 'available')
    }, 500)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [value])

  const availLabel =
    avail === 'checking' ? t('perfil.handle.checking') :
    avail === 'available' ? t('perfil.handle.available') :
    avail === 'taken'     ? t('perfil.handle.taken')    : ''

  const availColor =
    avail === 'available' ? colors.state.success :
    avail === 'taken'     ? colors.state.error   :
    'rgba(255,255,255,0.4)'

  const canSubmit = avail === 'available'

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.inputContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Current */}
        <Text style={styles.fieldLabel}>{t('perfil.handle.current')}</Text>
        <View style={styles.currentBox}>
          <Text style={styles.currentHandle}>{currentHandle}</Text>
        </View>

        {/* Cooldown */}
        {MOCK_IN_COOLDOWN && (
          <View style={styles.cooldownBox}>
            <Text style={styles.cooldownText}>
              {t('perfil.handle.cooldown', { date: MOCK_COOLDOWN_DATE })}
            </Text>
            <Text style={styles.cooldownHint}>{t('perfil.handle.cooldownHint')}</Text>
          </View>
        )}

        {/* New handle */}
        {!MOCK_IN_COOLDOWN && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>
              {t('perfil.handle.new')}
            </Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={setValue}
                placeholder={t('perfil.handle.newPlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.25)"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={24}
              />
              {avail === 'checking' && (
                <ActivityIndicator size="small" color={colors.gray[500]} />
              )}
            </View>

            {availLabel ? (
              <Text style={[styles.availLabel, { color: availColor }]}>{availLabel}</Text>
            ) : (
              <Text style={styles.cooldownHint}>{t('perfil.handle.cooldownHint')}</Text>
            )}

            <TouchableOpacity
              style={[styles.cta, !canSubmit && styles.ctaDisabled]}
              onPress={() => canSubmit && onConfirm(value.trim().replace(/^@/, ''))}
              disabled={!canSubmit}
              activeOpacity={0.75}
            >
              <Text style={[styles.ctaText, !canSubmit && styles.ctaTextDisabled]}>
                {t('perfil.handle.confirmCta')}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── StepSuccess ───────────────────────────────────────────────────────────────

function StepSuccess({ newHandle }: { newHandle: string }) {
  const { t } = useTranslation()
  return (
    <View style={styles.successWrap}>
      <View style={styles.successCircle}>
        <Text style={styles.successIcon}>✓</Text>
      </View>
      <Text style={styles.successTitle}>{t('perfil.handle.successTitle')}</Text>
      <Text style={styles.successBody}>
        {t('perfil.handle.successBody', { handle: newHandle })}
      </Text>
      <TouchableOpacity style={styles.cta} onPress={() => router.back()} activeOpacity={0.75}>
        <Text style={styles.ctaText}>{t('perfil.handle.backCta')}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HandleScreen() {
  const { t }     = useTranslation()
  const user      = useAuthStore(s => s.user)
  const setUser   = useAuthStore(s => s.setUser)

  const [step, setStep]           = useState<Step>('input')
  const [newHandle, setNewHandle] = useState('')
  const [pinError, setPinError]   = useState<string | null>(null)

  if (!user) return null

  const subtitles: Record<Step, string> = {
    input:    '1 / 3',
    pin:      '2 / 3',
    security: '3 / 3',
    success:  '',
  }

  const handleInputConfirm = (handle: string) => {
    setNewHandle(handle)
    setStep('pin')
  }

  const handlePinComplete = (_hash: string) => {
    // Mock: PIN aceito automaticamente
    setPinError(null)
    setStep('security')
  }

  const handleSecurityPass = () => {
    setUser({ ...user, handle: `@${newHandle}` })
    setStep('success')
  }

  const handleBack = () => {
    if (step === 'pin')      { setStep('input');    return }
    if (step === 'security') { setStep('pin');      return }
    router.back()
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header
        title={step === 'success' ? '' : `${t('perfil.handle.title')} · ${subtitles[step]}`}
        onBack={handleBack}
      />

      {step === 'input' && (
        <StepInput
          currentHandle={user.handle}
          onConfirm={handleInputConfirm}
        />
      )}

      {step === 'pin' && (
        <View style={styles.pinWrap}>
          <Text style={styles.stepEyebrow}>{t('perfil.handle.pinContext')}</Text>
          <Text style={styles.stepTitle}>{t('perfil.handle.pinSubtitle')}</Text>
          <PINInput onComplete={handlePinComplete} error={pinError} />
        </View>
      )}

      {step === 'security' && (
        <View style={styles.flex}>
          <SecurityConfirmation
            questions={MOCK_SECURITY_QUESTIONS}
            onPass={handleSecurityPass}
          />
        </View>
      )}

      {step === 'success' && <StepSuccess newHandle={newHandle} />}
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: { width: 32 },
  backIcon: { fontSize: 20, color: colors.white[100] },
  headerTitle: {
    ...typography.size.caption,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // Input step
  inputContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  fieldLabel: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.sm,
  },
  currentBox: {
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  currentHandle: {
    ...typography.size.body,
    color: 'rgba(255,255,255,0.6)',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 8,
  },
  input: {
    flex: 1,
    ...typography.size.body,
    color: colors.white[100],
    padding: 0,
  },
  availLabel: {
    ...typography.size.caption,
    marginTop: spacing.sm,
    marginLeft: 4,
  },
  cooldownBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: `${colors.warning[500]}14`,
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: `${colors.warning[500]}33`,
  },
  cooldownText: {
    ...typography.size.label,
    color: colors.warning[500],
    marginBottom: 4,
  },
  cooldownHint: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.35)',
    marginTop: spacing.sm,
  },
  // CTA
  cta: {
    marginTop: spacing.xl,
    height: spacing.buttonHeight,
    borderRadius: spacing.radius.md,
    backgroundColor: colors.white[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaDisabled: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  ctaText: {
    ...typography.button,
    color: colors.black[100],
  },
  ctaTextDisabled: {
    color: 'rgba(255,255,255,0.3)',
  },
  // PIN step
  pinWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  stepEyebrow: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.sm,
  },
  stepTitle: {
    ...typography.size.h2,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    marginBottom: spacing.xl,
  },
  // Success
  successWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${colors.state.success}1A`,
    borderWidth: 1,
    borderColor: `${colors.state.success}4D`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  successIcon: {
    fontSize: 28,
    color: colors.state.success,
  },
  successTitle: {
    ...typography.size.h1,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  successBody: {
    ...typography.size.bodySmall,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
})
