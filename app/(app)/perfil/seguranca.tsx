import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { PINInput } from '../../../components/financial/PINInput'
import { SecurityConfirmation } from '../../../components/financial/SecurityConfirmation'
import { useAuthStore } from '../../../store/auth.store'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'
import { validateCPF } from '../../../utils/cpf'
import { isValidEvpKey } from '../../../utils/pix'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}

type Mode =
  | 'main'
  | 'pin_current' | 'pin_new' | 'pin_confirm' | 'pin_security' | 'pin_sms' | 'pin_success'
  | 'pix_input'   | 'pix_pin' | 'pix_security'                              | 'pix_success'

type PixKeyType = 'cpf' | 'email' | 'phone' | 'random'

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
  eyebrow:      string
  title:        string
  mode?:        'secure' | 'setup'
  error?:       string | null
  onComplete:   (hash: string) => void
  /** Rejeita sequências óbvias (111111, 123456…) — só faz sentido ao definir um PIN novo. */
  checkObvious?: boolean
  onObvious?:    () => void
}

function PinStep({ eyebrow, title, mode = 'secure', error, onComplete, checkObvious = false, onObvious }: PinStepProps) {
  return (
    <View style={styles.pinWrap}>
      <Text style={styles.stepEyebrow}>{eyebrow}</Text>
      <Text style={styles.stepTitle}>{title}</Text>
      <PINInput mode={mode} onComplete={onComplete} error={error} checkObvious={checkObvious} onObvious={onObvious} />
    </View>
  )
}

// ── PixInputStep ──────────────────────────────────────────────────────────────

interface PixInputStepProps {
  error?:    string | null
  types:     { type: PixKeyType; label: string }[]
  onConfirm: (pixKey: string, pixKeyType: PixKeyType) => void
}

const ALL_PIX_TYPES: { type: PixKeyType; label: string }[] = [
  { type: 'cpf',    label: 'CPF' },
  { type: 'email',  label: 'E-mail' },
  { type: 'phone',  label: 'Telefone' },
  { type: 'random', label: 'Chave aleatória' },
]

// Espelha a validação de supabase/functions/perfil-update-pix/index.ts (isValidPixKey)
// para não deixar o usuário passar por PIN + segurança só pra ser rejeitado no fim.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s()-]{10,15}$/

function PixInputStep({ error, types, onConfirm }: PixInputStepProps) {
  const { t }                    = useTranslation()
  const [pixKey, setPixKey]      = useState('')
  const [pixType, setPixType]    = useState<PixKeyType>(types[0]?.type ?? 'random')

  const canSubmit = (() => {
    const trimmed = pixKey.trim()
    switch (pixType) {
      case 'cpf':    return validateCPF(pixKey) && pixKey.replace(/\D/g, '').length === 11
      case 'email':  return EMAIL_RE.test(trimmed)
      case 'phone':  return PHONE_RE.test(trimmed)
      case 'random': return isValidEvpKey(trimmed)
    }
  })()

  const handleTypeChange = (type: PixKeyType) => {
    setPixType(type)
    setPixKey('')
  }

  const handleKeyChange = (v: string) => {
    if (pixType === 'cpf')   setPixKey(maskCPF(v))
    else if (pixType === 'phone') setPixKey(v.replace(/\D/g, '').slice(0, 15))
    else                     setPixKey(v)
  }

  const handleConfirm = () => {
    if (!canSubmit) return
    const key = pixType === 'cpf' ? pixKey.replace(/\D/g, '') : pixKey.trim()
    onConfirm(key, pixType)
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.inputContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepEyebrow}>{t('perfil.seguranca.sectionPix')}</Text>
        <Text style={styles.stepTitle}>{t('perfil.seguranca.pixNewTitle')}</Text>
        <Text style={styles.pixWithdrawalNote}>{t('perfil.seguranca.pixWithdrawalNote')}</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Text style={styles.fieldLabel}>{t('perfil.seguranca.pixKeyType')}</Text>
        <View style={styles.pixTypeRow}>
          {types.map(({ type, label }) => (
            <TouchableOpacity
              key={type}
              style={[styles.pixTypeBtn, pixType === type && styles.pixTypeBtnActive]}
              onPress={() => handleTypeChange(type)}
              activeOpacity={0.75}
            >
              <Text style={[styles.pixTypeBtnText, pixType === type && styles.pixTypeBtnTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>{t('perfil.seguranca.pixKeyValue')}</Text>
        <TextInput
          style={styles.securityInput}
          value={pixKey}
          onChangeText={handleKeyChange}
          placeholder={pixType === 'random' ? t('perfil.seguranca.pixRandomPlaceholder') : t('perfil.seguranca.pixKeyPlaceholder')}
          placeholderTextColor="rgba(255,255,255,0.25)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={pixType === 'phone' ? 'phone-pad' : pixType === 'cpf' ? 'numeric' : 'default'}
        />

        <TouchableOpacity
          style={[styles.cta, !canSubmit && styles.ctaDisabled]}
          onPress={handleConfirm}
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

// ── SmsStep ───────────────────────────────────────────────────────────────────

interface SmsStepProps {
  loading: boolean
  error:   string | null
  onConfirm: (code: string) => void
}

function SmsStep({ loading, error, onConfirm }: SmsStepProps) {
  const { t }           = useTranslation()
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

        {error && <Text style={styles.errorText}>{error}</Text>}

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

        <TouchableOpacity
          style={[styles.cta, (!isValid || loading) && styles.ctaDisabled]}
          onPress={() => isValid && !loading && onConfirm(code)}
          disabled={!isValid || loading}
          activeOpacity={0.75}
        >
          {loading
            ? <ActivityIndicator color={colors.black[100]} />
            : <Text style={[styles.ctaText, (!isValid || loading) && styles.ctaTextDisabled]}>
                {t('perfil.seguranca.smsCta')}
              </Text>
          }
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
  pixKey:      string
  canChangePix: boolean
  onStartPin:  () => void
  onStartPix:  () => void
}

function MainView({ pixKey, canChangePix, onStartPin, onStartPix }: MainViewProps) {
  const { t } = useTranslation()

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.mainContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <Text style={styles.eyebrow}>{t('perfil.seguranca.sectionPin')}</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={onStartPin} activeOpacity={0.75}>
          <Text style={styles.actionBtnText}>{t('perfil.rowPin')}</Text>
          <Text style={styles.actionBtnChevron}>›</Text>
        </TouchableOpacity>
      </View>

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

      <View style={styles.section}>
        <Text style={styles.eyebrow}>{t('perfil.seguranca.sectionPix')}</Text>
        <Text style={styles.pixWithdrawalNote}>{t('perfil.seguranca.pixWithdrawalNote')}</Text>
        <View style={styles.pixRow}>
          <Text style={styles.pixLabel}>{t('perfil.seguranca.pixCurrent')}</Text>
          <Text style={styles.pixValue}>{pixKey}</Text>
        </View>
        {canChangePix && (
          <TouchableOpacity style={[styles.outlineBtn, { marginTop: spacing.md }]} onPress={onStartPix} activeOpacity={0.75}>
            <Text style={styles.outlineBtnText}>{t('perfil.seguranca.pixChange')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SegurancaScreen() {
  const { t }     = useTranslation()
  const user      = useAuthStore(s => s.user)
  const token     = useAuthStore(s => s.token)
  const logout    = useAuthStore(s => s.logout)

  const [mode, setMode]               = useState<Mode>('main')
  const [currentPixKey, setCurrentPixKey] = useState(user?.pixKey ?? '')
  const [currentPixKeyType, setCurrentPixKeyType] = useState<PixKeyType | null>(null)
  const [hasPixKey, setHasPixKey]         = useState(false)

  // PIN flow state
  const [currentPinHash, setCurrentPinHash]     = useState('')
  const [newPinHash, setNewPinHash]             = useState('')
  const [pinError, setPinError]                 = useState<string | null>(null)
  const [confirmError, setConfirmError]         = useState<string | null>(null)
  const [securityError, setSecurityError]       = useState<string | null>(null)
  const [smsError, setSmsError]                 = useState<string | null>(null)
  const [pinSecurityHash, setPinSecurityHash]   = useState('')
  const [submitting, setSubmitting]             = useState(false)
  const [pinWrongAnswer, setPinWrongAnswer]     = useState(false)

  // Pix flow state
  const [pixKey, setPixKey]                     = useState('')
  const [pixKeyType, setPixKeyType]             = useState<PixKeyType>('cpf')
  const [pixPinHash, setPixPinHash]             = useState('')
  const [pixInputError, setPixInputError]       = useState<string | null>(null)
  const [pixSecurityError, setPixSecurityError] = useState<string | null>(null)
  const [pixWrongAnswer, setPixWrongAnswer]     = useState(false)

  // Carrega chave PIX atual via perfil
  useEffect(() => {
    if (!token) return
    fetch(`${BFF}/user-profile`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.pix_key_masked) setCurrentPixKey(d.pix_key_masked)
        setHasPixKey(!!d?.has_pix_key)
        setCurrentPixKeyType(d?.has_pix_key ? (d?.pix_key_type ?? null) : null)
      })
      .catch(() => {})
  }, [token])

  if (!user) return null

  const authHeader = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY }

  const headerLabel = (() => {
    if (mode === 'main')         return t('perfil.seguranca.title')
    if (mode.startsWith('pin_')) return t('perfil.seguranca.sectionPin')
    if (mode.startsWith('pix_')) return t('perfil.seguranca.sectionPix')
    return t('perfil.seguranca.title')
  })()

  const handleBack = () => {
    switch (mode) {
      case 'pin_current':  setMode('main');         break
      case 'pin_new':      setMode('pin_current');  break
      case 'pin_confirm':  setPinError(null); setMode('pin_new'); break
      case 'pin_security': setMode('pin_confirm');  break
      case 'pin_sms':      setMode('pin_security'); break
      case 'pin_success':  setMode('main');         break
      case 'pix_input':    setMode('main');         break
      case 'pix_pin':      setMode('pix_input');    break
      case 'pix_security': setMode('pix_pin');      break
      case 'pix_success':  setMode('main');         break
      default:             router.back()
    }
  }

  // ── PIN flow ─────────────────────────────────────────────────────────────────

  const handleCurrentPin = (hash: string) => {
    setCurrentPinHash(hash)
    setPinError(null)
    setMode('pin_new')
  }

  const handleNewPin = (hash: string) => {
    if (hash === currentPinHash) {
      setPinError(t('perfil.seguranca.pinMismatch'))
      return
    }
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

  const handlePinSecurity = async (answerHash: string) => {
    setPinSecurityHash(answerHash)
    setSecurityError(null)
    setSubmitting(true)
    try {
      await fetch(`${BFF}/perfil-send-sms`, {
        method:  'POST',
        headers: authHeader,
        body:    JSON.stringify({ purpose: 'pin_change' }),
      })
    } catch {
      // best-effort — prossegue mesmo se o envio falhar
    } finally {
      setSubmitting(false)
    }
    setMode('pin_sms')
  }

  const handleSmsConfirm = async (code: string) => {
    setSubmitting(true)
    setSmsError(null)
    try {
      const res  = await fetch(`${BFF}/perfil-update-pin`, {
        method:  'POST',
        headers: authHeader,
        body:    JSON.stringify({
          current_pin_hash:     currentPinHash,
          new_pin_hash:         newPinHash,
          security_answer_hash: pinSecurityHash,
          sms_code:             code,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.code === 'INVALID_CREDENTIALS' && data.message?.includes('atual')) {
          setPinError(t('perfil.seguranca.pinCurrentError'))
          setMode('pin_current')
        } else if (data.code === 'INVALID_CREDENTIALS' && data.message?.includes('segurança')) {
          setSecurityError(t('perfil.handle.securityError'))
          setMode('pin_security')
        } else if (data.code === 'SMS_INVALID' || data.code === 'SMS_EXPIRED') {
          setSmsError(data.message ?? t('perfil.seguranca.smsError'))
        } else if (data.code === 'WEAK_PIN') {
          setMode('pin_new')
        } else if (data.code === 'PIN_SAME') {
          setMode('pin_new')
        } else {
          setSmsError(data.message ?? t('common.genericError'))
        }
        return
      }

      setMode('pin_success')
    } catch {
      setSmsError(t('common.genericError'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Pix flow ─────────────────────────────────────────────────────────────────

  const handlePixInput = (key: string, type: PixKeyType) => {
    setPixKey(key)
    setPixKeyType(type)
    setPixInputError(null)
    setMode('pix_pin')
  }

  const handlePixPin = (hash: string) => {
    setPixPinHash(hash)
    setMode('pix_security')
  }

  const handlePixSecurity = async (answerHash: string) => {
    setSubmitting(true)
    setPixSecurityError(null)
    try {
      const res  = await fetch(`${BFF}/perfil-update-pix`, {
        method:  'POST',
        headers: authHeader,
        body:    JSON.stringify({
          pix_key:              pixKey,
          pix_key_type:         pixKeyType,
          pin_hash:             pixPinHash,
          security_answer_hash: answerHash,
        }),
      })
      const data = await res.json()
      console.log(`[perfil-update-pix] HTTP ${res.status}`, JSON.stringify(data))

      if (!res.ok) {
        if (data.code === 'WRONG_SECURITY_ANSWER' || data.code === 'INVALID_CREDENTIALS') {
          if (data.message?.includes('PIN')) {
            setMode('pix_pin')
            return
          }
          setPixWrongAnswer(true)
          setTimeout(() => setPixWrongAnswer(false), 1800)
        } else if (data.code === 'INVALID_PIX_KEY' || data.code === 'INVALID_PIX_TYPE') {
          setPixInputError(data.message ?? t('common.genericError'))
          setMode('pix_input')
        } else {
          setPixSecurityError(data.message ?? t('common.genericError'))
        }
        return
      }

      setMode('pix_success')
    } catch (e) {
      console.log('[perfil-update-pix] network error', e)
      setPixSecurityError(t('common.genericError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header label={headerLabel} onBack={handleBack} />

      {mode === 'main' && (
        <MainView
          pixKey={currentPixKey}
          canChangePix={!(hasPixKey && currentPixKeyType === 'cpf')}
          onStartPin={() => setMode('pin_current')}
          onStartPix={() => setMode('pix_input')}
        />
      )}

      {mode === 'pin_current' && (
        <PinStep
          eyebrow={t('perfil.seguranca.currentPin')}
          title={t('perfil.seguranca.currentPinSub')}
          mode="secure"
          error={pinError}
          onComplete={handleCurrentPin}
        />
      )}

      {mode === 'pin_new' && (
        <PinStep
          eyebrow={t('perfil.seguranca.newPin')}
          title={t('perfil.seguranca.newPinSub')}
          mode="setup"
          error={pinError}
          checkObvious
          onObvious={() => setPinError(t('auth.onboarding.pin.obvious'))}
          onComplete={handleNewPin}
        />
      )}

      {mode === 'pin_confirm' && (
        <PinStep
          eyebrow={t('perfil.seguranca.confirmPin')}
          title={t('perfil.seguranca.confirmPinSub')}
          mode="setup"
          error={confirmError}
          onComplete={handleConfirmPin}
        />
      )}

      {mode === 'pin_security' && (
        <View style={styles.flex}>
          <SecurityConfirmation
            identifier={`@${user.handle}`}
            pinHash={currentPinHash}
            eyebrow={t('perfil.seguranca.sectionQuestions')}
            submitting={submitting}
            wrongAnswer={pinWrongAnswer}
            onPass={handlePinSecurity}
          />
        </View>
      )}

      {mode === 'pin_sms' && (
        <SmsStep
          loading={submitting}
          error={smsError}
          onConfirm={handleSmsConfirm}
        />
      )}

      {mode === 'pin_success' && (
        <SuccessStep
          message={t('perfil.seguranca.pinChanged')}
          onBack={async () => {
            await logout()
            router.replace('/(auth)/login')
          }}
        />
      )}

      {mode === 'pix_input' && (
        <PixInputStep
          error={pixInputError}
          types={hasPixKey ? ALL_PIX_TYPES.filter(pt => pt.type !== 'cpf') : ALL_PIX_TYPES}
          onConfirm={handlePixInput}
        />
      )}

      {mode === 'pix_pin' && (
        <PinStep
          eyebrow={t('perfil.seguranca.sectionPix')}
          title={t('perfil.seguranca.currentPinSub')}
          mode="secure"
          onComplete={handlePixPin}
        />
      )}

      {mode === 'pix_security' && (
        <View style={styles.flex}>
          {pixSecurityError && <Text style={[styles.errorText, styles.pixSecurityErrorSpacing]}>{pixSecurityError}</Text>}
          <SecurityConfirmation
            identifier={`@${user.handle}`}
            pinHash={pixPinHash}
            eyebrow={t('perfil.seguranca.sectionQuestions')}
            submitting={submitting}
            wrongAnswer={pixWrongAnswer}
            onPass={handlePixSecurity}
          />
        </View>
      )}

      {mode === 'pix_success' && (
        <SuccessStep
          message={t('perfil.seguranca.pixChanged')}
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
  inputContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
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
  pixWithdrawalNote: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 17,
    marginBottom: spacing.md,
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
  fieldLabel: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.sm,
  },
  pixTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pixTypeBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: spacing.radius.sm,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pixTypeBtnActive: {
    backgroundColor: colors.white[100],
    borderColor: colors.white[100],
  },
  pixTypeBtnText: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.6)',
  },
  pixTypeBtnTextActive: {
    color: colors.black[100],
    fontWeight: typography.weight.bold,
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
  errorText: {
    ...typography.size.caption,
    color: colors.state.error,
    marginBottom: spacing.sm,
  },
  pixSecurityErrorSpacing: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
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
  successIcon: { fontSize: 28, color: colors.state.success },
  successMsg: {
    ...typography.size.body,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
})
