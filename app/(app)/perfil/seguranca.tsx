import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
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

type Mode =
  | 'main'
  | 'pin_current' | 'pin_new' | 'pin_confirm' | 'pin_security' | 'pin_sms' | 'pin_success'
  | 'pix_pin'     | 'pix_security'                                           | 'pix_success'

const MOCK_SMS_CODE = '123456'

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps { label: string; onBack: () => void }

function Header({ label, onBack }: HeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{label}</Text>
      <View style={styles.backBtn} />
    </View>
  )
}

// ── PinStep ───────────────────────────────────────────────────────────────────

interface PinStepProps {
  eyebrow: string
  title: string
  error?: string | null
  onComplete: (hash: string) => void
}

function PinStep({ eyebrow, title, error, onComplete }: PinStepProps) {
  return (
    <View style={styles.pinWrap}>
      <Text style={styles.stepEyebrow}>{eyebrow}</Text>
      <Text style={styles.stepTitle}>{title}</Text>
      <PINInput onComplete={onComplete} error={error} checkObvious={false} />
    </View>
  )
}

// ── SmsStep ───────────────────────────────────────────────────────────────────

interface SmsStepProps { onConfirm: () => void }

function SmsStep({ onConfirm }: SmsStepProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const isValid         = code.length === 6

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.smsWrap}>
        <Text style={styles.stepEyebrow}>{t('perfil.seguranca.smsCode')}</Text>
        <Text style={styles.stepTitle}>{t('perfil.seguranca.smsHint')}</Text>

        <TextInput
          style={styles.smsInput}
          value={code}
          onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
          placeholder={t('perfil.seguranca.smsPlaceholder')}
          placeholderTextColor="rgba(255,255,255,0.25)"
          keyboardType="number-pad"
          maxLength={6}
          textAlign="center"
        />
        <Text style={styles.smsMock}>Mock: código é {MOCK_SMS_CODE}</Text>

        <TouchableOpacity
          style={[styles.cta, !isValid && styles.ctaDisabled]}
          onPress={() => isValid && onConfirm()}
          disabled={!isValid}
          activeOpacity={0.75}
        >
          <Text style={[styles.ctaText, !isValid && styles.ctaTextDisabled]}>
            {t('perfil.seguranca.smsCta')}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

// ── SuccessStep ───────────────────────────────────────────────────────────────

interface SuccessStepProps { message: string; onBack: () => void }

function SuccessStep({ message, onBack }: SuccessStepProps) {
  const { t } = useTranslation()
  return (
    <View style={styles.successWrap}>
      <View style={styles.successCircle}>
        <Text style={styles.successIcon}>✓</Text>
      </View>
      <Text style={styles.successMsg}>{message}</Text>
      <TouchableOpacity style={styles.cta} onPress={onBack} activeOpacity={0.75}>
        <Text style={styles.ctaText}>{t('perfil.handle.backCta')}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

interface MainViewProps {
  pixKey: string
  onStartPin: () => void
  onStartPix: () => void
}

function MainView({ pixKey, onStartPin, onStartPix }: MainViewProps) {
  const { t } = useTranslation()

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.mainContent}
      showsVerticalScrollIndicator={false}
    >
      {/* TROCAR PIN */}
      <View style={styles.section}>
        <Text style={styles.eyebrow}>{t('perfil.seguranca.sectionPin')}</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={onStartPin} activeOpacity={0.75}>
          <Text style={styles.actionBtnText}>{t('perfil.rowPin')}</Text>
          <Text style={styles.actionBtnChevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* PERGUNTAS DE SEGURANÇA */}
      <View style={styles.section}>
        <Text style={styles.eyebrow}>{t('perfil.seguranca.sectionQuestions')}</Text>
        {[1, 2, 3, 4].map(n => (
          <View key={n} style={styles.questionRow}>
            <Text style={styles.questionLabel}>
              {t('perfil.seguranca.questionLabel', { n })}
            </Text>
            <Text style={styles.questionStatus}>{t('perfil.seguranca.questionStatus')}</Text>
          </View>
        ))}
        <TouchableOpacity style={[styles.outlineBtn, { marginTop: spacing.md }]} activeOpacity={0.75}>
          <Text style={styles.outlineBtnText}>{t('perfil.seguranca.updateQuestions')}</Text>
        </TouchableOpacity>
      </View>

      {/* CHAVE PIX */}
      <View style={styles.section}>
        <Text style={styles.eyebrow}>{t('perfil.seguranca.sectionPix')}</Text>
        <View style={styles.pixRow}>
          <Text style={styles.pixLabel}>{t('perfil.seguranca.pixCurrent')}</Text>
          <Text style={styles.pixValue}>{pixKey}</Text>
        </View>
        <TouchableOpacity style={[styles.outlineBtn, { marginTop: spacing.md }]} onPress={onStartPix} activeOpacity={0.75}>
          <Text style={styles.outlineBtnText}>{t('perfil.seguranca.pixChange')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SegurancaScreen() {
  const { t }   = useTranslation()
  const user    = useAuthStore(s => s.user)

  const [mode, setMode]           = useState<Mode>('main')
  const [newPinHash, setNewPinHash] = useState('')
  const [pinError, setPinError]   = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  if (!user) return null

  const headerLabel = (() => {
    if (mode === 'main')                  return t('perfil.seguranca.title')
    if (mode.startsWith('pin_'))          return t('perfil.seguranca.sectionPin')
    if (mode.startsWith('pix_'))          return t('perfil.seguranca.sectionPix')
    return t('perfil.seguranca.title')
  })()

  const handleBack = () => {
    switch (mode) {
      case 'pin_current':  setMode('main');         break
      case 'pin_new':      setMode('pin_current');  break
      case 'pin_confirm':  setMode('pin_new');      break
      case 'pin_security': setMode('pin_confirm');  break
      case 'pin_sms':      setMode('pin_security'); break
      case 'pin_success':  setMode('main');         break
      case 'pix_pin':      setMode('main');         break
      case 'pix_security': setMode('pix_pin');      break
      case 'pix_success':  setMode('main');         break
      default:             router.back();
    }
  }

  // PIN flow
  const handleCurrentPin = (_hash: string) => {
    setPinError(null)
    setMode('pin_new')
  }

  const handleNewPin = (hash: string) => {
    setNewPinHash(hash)
    setMode('pin_confirm')
  }

  const handleConfirmPin = (hash: string) => {
    if (hash !== newPinHash) {
      setConfirmError(t('perfil.seguranca.pinMismatch'))
      return
    }
    setConfirmError(null)
    setMode('pin_security')
  }

  const handlePinSecurity = () => setMode('pin_sms')

  const handleSmsConfirm = () => setMode('pin_success')

  // Pix flow
  const handlePixPin = (_hash: string) => setMode('pix_security')
  const handlePixSecurity = () => setMode('pix_success')

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header label={headerLabel} onBack={handleBack} />

      {mode === 'main' && (
        <MainView
          pixKey={user.pixKey}
          onStartPin={() => setMode('pin_current')}
          onStartPix={() => setMode('pix_pin')}
        />
      )}

      {mode === 'pin_current' && (
        <PinStep
          eyebrow={t('perfil.seguranca.currentPin')}
          title={t('perfil.seguranca.currentPinSub')}
          error={pinError}
          onComplete={handleCurrentPin}
        />
      )}

      {mode === 'pin_new' && (
        <PinStep
          eyebrow={t('perfil.seguranca.newPin')}
          title={t('perfil.seguranca.newPinSub')}
          onComplete={handleNewPin}
        />
      )}

      {mode === 'pin_confirm' && (
        <PinStep
          eyebrow={t('perfil.seguranca.confirmPin')}
          title={t('perfil.seguranca.confirmPinSub')}
          error={confirmError}
          onComplete={handleConfirmPin}
        />
      )}

      {mode === 'pin_security' && (
        <View style={styles.flex}>
          <SecurityConfirmation
            questions={MOCK_SECURITY_QUESTIONS}
            onPass={handlePinSecurity}
          />
        </View>
      )}

      {mode === 'pin_sms' && <SmsStep onConfirm={handleSmsConfirm} />}

      {mode === 'pin_success' && (
        <SuccessStep
          message={t('perfil.seguranca.pinChanged')}
          onBack={() => { setMode('main'); router.back() }}
        />
      )}

      {mode === 'pix_pin' && (
        <PinStep
          eyebrow={t('perfil.seguranca.sectionPix')}
          title={t('perfil.seguranca.currentPinSub')}
          onComplete={handlePixPin}
        />
      )}

      {mode === 'pix_security' && (
        <View style={styles.flex}>
          <SecurityConfirmation
            questions={MOCK_SECURITY_QUESTIONS}
            onPass={handlePixSecurity}
          />
        </View>
      )}

      {mode === 'pix_success' && (
        <SuccessStep
          message={t('perfil.seguranca.pixChange') + ' confirmada.'}
          onBack={() => setMode('main')}
        />
      )}
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
  backBtn:    { width: 32 },
  backIcon:   { fontSize: 20, color: colors.white[100] },
  headerTitle: {
    ...typography.size.caption,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // Main view
  mainContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  actionBtnText: {
    flex: 1,
    ...typography.size.label,
    color: colors.white[100],
  },
  actionBtnChevron: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.2)',
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  questionLabel: {
    ...typography.size.label,
    color: 'rgba(255,255,255,0.7)',
  },
  questionStatus: {
    ...typography.size.caption,
    color: colors.state.success,
  },
  outlineBtn: {
    paddingVertical: 13,
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
  outlineBtnText: {
    ...typography.size.label,
    fontWeight: typography.weight.medium,
    color: colors.white[100],
  },
  pixRow: {
    paddingVertical: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  pixLabel: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 4,
  },
  pixValue: {
    ...typography.size.body,
    color: colors.white[100],
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
  // SMS step
  smsWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  smsInput: {
    marginTop: spacing.xl,
    height: spacing.inputHeight,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: spacing.radius.md,
    ...typography.size.h1,
    color: colors.white[100],
    letterSpacing: 8,
  },
  smsMock: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
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
  successIcon: { fontSize: 28, color: colors.state.success },
  successMsg: {
    ...typography.size.body,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
})
