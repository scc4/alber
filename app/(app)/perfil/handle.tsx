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
import { useAuthStore } from '../../../store/auth.store'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'
import { sha256Hex, normalizeSecurityAnswer } from '../../../utils/crypto'
import { formatDate } from '../../../utils/format'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

type Step        = 'input' | 'pin' | 'security' | 'success'
type Availability = 'idle' | 'checking' | 'available' | 'taken'

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
  currentHandle:    string
  inCooldown:       boolean
  nextAllowedDate:  string
  onConfirm:        (newHandle: string) => void
}

function StepInput({ currentHandle, inCooldown, nextAllowedDate, onConfirm }: StepInputProps) {
  const { t }                    = useTranslation()
  const [value, setValue]        = useState('')
  const [avail, setAvail]        = useState<Availability>('idle')
  const debounceRef              = useRef<ReturnType<typeof setTimeout> | null>(null)
  const token                    = useAuthStore(s => s.token)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const clean = value.trim().replace(/^@/, '').toLowerCase()

    if (clean.length < 3) { setAvail('idle'); return }

    setAvail('checking')
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`${BFF}/perfil-update-handle`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            Authorization:   `Bearer ${token}`,
            apikey:          ANON_KEY,
          },
          // dry-run: send obviously-wrong credentials to trigger HANDLE_TAKEN vs other errors
          body: JSON.stringify({ new_handle: clean, pin_hash: '__check__', security_answer_hash: '__check__' }),
        })
        const data = await res.json()
        // HANDLE_TAKEN means the handle exists; anything else (including PIN errors) means it's available
        setAvail(data.code === 'HANDLE_TAKEN' || data.code === 'HANDLE_SAME' ? 'taken' : 'available')
      } catch {
        setAvail('idle')
      }
    }, 600)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [value])

  const availLabel =
    avail === 'checking'  ? t('perfil.handle.checking') :
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
        <Text style={styles.fieldLabel}>{t('perfil.handle.current')}</Text>
        <View style={styles.currentBox}>
          <Text style={styles.currentHandle}>{currentHandle}</Text>
        </View>

        {inCooldown && (
          <View style={styles.cooldownBox}>
            <Text style={styles.cooldownText}>
              {t('perfil.handle.cooldown', { date: nextAllowedDate })}
            </Text>
            <Text style={styles.cooldownHint}>{t('perfil.handle.cooldownHint')}</Text>
          </View>
        )}

        {!inCooldown && (
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

// ── StepSecurity (text input for answer) ─────────────────────────────────────

interface StepSecurityProps {
  onConfirm: (answerHash: string) => void
}

function StepSecurity({ onConfirm }: StepSecurityProps) {
  const { t }           = useTranslation()
  const [answer, setAnswer] = useState('')
  const canSubmit           = answer.trim().length >= 2

  const handleConfirm = async () => {
    const hash = await sha256Hex(normalizeSecurityAnswer(answer))
    onConfirm(hash)
  }

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
        <Text style={styles.stepEyebrow}>{t('perfil.handle.securityContext')}</Text>
        <Text style={styles.stepTitle}>{t('perfil.handle.securitySubtitle')}</Text>

        <TextInput
          style={styles.securityInput}
          value={answer}
          onChangeText={setAnswer}
          placeholder={t('perfil.handle.securityPlaceholder')}
          placeholderTextColor="rgba(255,255,255,0.25)"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={canSubmit ? handleConfirm : undefined}
        />

        <TouchableOpacity
          style={[styles.cta, !canSubmit && styles.ctaDisabled]}
          onPress={canSubmit ? handleConfirm : undefined}
          disabled={!canSubmit}
          activeOpacity={0.75}
        >
          <Text style={[styles.ctaText, !canSubmit && styles.ctaTextDisabled]}>
            {t('perfil.handle.confirmCta')}
          </Text>
        </TouchableOpacity>
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
  const { t }   = useTranslation()
  const user    = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  const token   = useAuthStore(s => s.token)

  const [step, setStep]                   = useState<Step>('input')
  const [newHandle, setNewHandle]         = useState('')
  const [pinHash, setPinHash]             = useState('')
  const [pinError, setPinError]           = useState<string | null>(null)
  const [submitError, setSubmitError]     = useState<string | null>(null)
  const [submitting, setSubmitting]       = useState(false)
  const [inCooldown, setInCooldown]       = useState(false)
  const [nextAllowedDate, setNextAllowed] = useState('')

  // Check cooldown from DB on mount
  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const res  = await fetch(`${BFF}/perfil-update-handle`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
          body:    JSON.stringify({ new_handle: 'x', pin_hash: '__check__', security_answer_hash: '__check__' }),
        })
        const data = await res.json()
        if (data.code === 'HANDLE_COOLDOWN' && data.next_allowed_at) {
          setInCooldown(true)
          setNextAllowed(formatDate(data.next_allowed_at))
        }
      } catch {}
    })()
  }, [token])

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

  const handlePinComplete = (hash: string) => {
    setPinHash(hash)
    setPinError(null)
    setStep('security')
  }

  const handleSecurityConfirm = async (answerHash: string) => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res  = await fetch(`${BFF}/perfil-update-handle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
        body:    JSON.stringify({
          new_handle:            newHandle,
          pin_hash:              pinHash,
          security_answer_hash:  answerHash,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.code === 'INVALID_CREDENTIALS' && data.message?.includes('PIN')) {
          setPinError(t('perfil.handle.pinError'))
          setStep('pin')
        } else if (data.code === 'INVALID_CREDENTIALS') {
          setSubmitError(t('perfil.handle.securityError'))
        } else if (data.code === 'HANDLE_TAKEN') {
          setSubmitError(t('perfil.handle.taken'))
          setStep('input')
        } else {
          setSubmitError(data.message ?? t('common.genericError'))
        }
        return
      }

      setUser({ ...user, handle: data.handle })
      setStep('success')
    } catch {
      setSubmitError(t('common.genericError'))
    } finally {
      setSubmitting(false)
    }
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
          inCooldown={inCooldown}
          nextAllowedDate={nextAllowedDate}
          onConfirm={handleInputConfirm}
        />
      )}

      {step === 'pin' && (
        <View style={styles.pinWrap}>
          <Text style={styles.stepEyebrow}>{t('perfil.handle.pinContext')}</Text>
          <Text style={styles.stepTitle}>{t('perfil.handle.pinSubtitle')}</Text>
          {pinError && <Text style={styles.errorText}>{pinError}</Text>}
          <PINInput onComplete={handlePinComplete} error={pinError} />
        </View>
      )}

      {step === 'security' && (
        <View style={styles.flex}>
          {submitError && (
            <Text style={[styles.errorText, { paddingHorizontal: spacing.lg, marginTop: spacing.sm }]}>
              {submitError}
            </Text>
          )}
          {submitting ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.white[100]} />
            </View>
          ) : (
            <StepSecurity onConfirm={handleSecurityConfirm} />
          )}
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
  securityInput: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    ...typography.size.body,
    color: colors.white[100],
  },
  errorText: {
    ...typography.size.caption,
    color: colors.state.error,
    marginBottom: spacing.sm,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
