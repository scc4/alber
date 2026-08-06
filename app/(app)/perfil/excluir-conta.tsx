// Design: segue o padrão de app/(app)/perfil/seguranca.tsx (PIN → pergunta de segurança → SMS)
// Spec: /specs/06_modules/perfil.md — Conta e Privacidade > Excluir minha conta
// Soft delete — exigido pelas políticas de Google Play/App Store para apps com criação de conta.

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

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

type Mode = 'loading' | 'blocked' | 'aviso' | 'pin' | 'security' | 'sms' | 'confirm' | 'success'

interface EligibilityBlocks {
  positive_balance:           boolean
  owns_active_split:           boolean
  owns_active_lounge:          boolean
  active_split_participation:  boolean
}

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

// ── SmsStep ───────────────────────────────────────────────────────────────────

interface SmsStepProps { loading: boolean; error: string | null; onConfirm: (code: string) => void }

function SmsStep({ loading, error, onConfirm }: SmsStepProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const isValid = code.length === 6

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.stepWrap}>
        <Text style={styles.stepEyebrow}>{t('perfil.excluirConta.smsCode')}</Text>
        <Text style={styles.stepTitle}>{t('perfil.excluirConta.smsHint')}</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TextInput
          style={styles.smsInput}
          value={code}
          onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
          placeholder={t('perfil.excluirConta.smsPlaceholder')}
          placeholderTextColor="rgba(255,255,255,0.25)"
          keyboardType="number-pad"
          maxLength={6}
          textAlign="center"
        />

        <TouchableOpacity
          style={[styles.dangerCta, (!isValid || loading) && styles.ctaDisabled]}
          onPress={() => isValid && !loading && onConfirm(code)}
          disabled={!isValid || loading}
          activeOpacity={0.75}
        >
          {loading
            ? <ActivityIndicator color={colors.white[100]} />
            : <Text style={styles.dangerCtaText}>{t('perfil.excluirConta.smsCta')}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

// ── ConfirmStep — última confirmação explícita ────────────────────────────────

interface ConfirmStepProps { loading: boolean; error: string | null; onConfirm: () => void }

function ConfirmStep({ loading, error, onConfirm }: ConfirmStepProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const isValid = text.trim().toUpperCase() === 'EXCLUIR'

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.stepWrap} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepEyebrow}>{t('perfil.excluirConta.confirmTitle')}</Text>
        <Text style={styles.stepTitle}>{t('perfil.excluirConta.confirmBody')}</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TextInput
          style={styles.smsInput}
          value={text}
          onChangeText={setText}
          placeholder={t('perfil.excluirConta.confirmPlaceholder')}
          placeholderTextColor="rgba(255,255,255,0.25)"
          autoCapitalize="characters"
          autoCorrect={false}
          textAlign="center"
        />

        <TouchableOpacity
          style={[styles.dangerCta, (!isValid || loading) && styles.ctaDisabled]}
          onPress={() => isValid && !loading && onConfirm()}
          disabled={!isValid || loading}
          activeOpacity={0.75}
        >
          {loading
            ? <ActivityIndicator color={colors.white[100]} />
            : <Text style={styles.dangerCtaText}>{t('perfil.excluirConta.confirmCta')}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── SuccessStep ───────────────────────────────────────────────────────────────

function SuccessStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  return (
    <View style={styles.successWrap}>
      <View style={styles.successCircle}>
        <Text style={styles.successIcon}>✓</Text>
      </View>
      <Text style={styles.successTitle}>{t('perfil.excluirConta.successTitle')}</Text>
      <Text style={styles.successMsg}>{t('perfil.excluirConta.successBody')}</Text>
      <TouchableOpacity style={styles.cta} onPress={onDone} activeOpacity={0.75}>
        <Text style={styles.ctaText}>{t('perfil.excluirConta.successCta')}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── BlockedStep ───────────────────────────────────────────────────────────────

function BlockedStep({ blocks, onBack }: { blocks: EligibilityBlocks; onBack: () => void }) {
  const { t } = useTranslation()
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.stepWrap} showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>{t('perfil.excluirConta.blockedTitle')}</Text>

      {blocks.positive_balance && (
        <View style={styles.blockCard}>
          <Text style={styles.blockText}>{t('perfil.excluirConta.blockedBalance')}</Text>
          <TouchableOpacity onPress={() => router.replace('/(app)/carregar')} activeOpacity={0.75}>
            <Text style={styles.blockLink}>{t('perfil.excluirConta.blockedBalanceCta')} ›</Text>
          </TouchableOpacity>
        </View>
      )}
      {blocks.owns_active_split && (
        <View style={styles.blockCard}>
          <Text style={styles.blockText}>{t('perfil.excluirConta.blockedSplitOwner')}</Text>
        </View>
      )}
      {blocks.owns_active_lounge && (
        <View style={styles.blockCard}>
          <Text style={styles.blockText}>{t('perfil.excluirConta.blockedLoungeOwner')}</Text>
        </View>
      )}
      {blocks.active_split_participation && (
        <View style={styles.blockCard}>
          <Text style={styles.blockText}>{t('perfil.excluirConta.blockedSplitParticipant')}</Text>
        </View>
      )}

      <TouchableOpacity style={[styles.cta, { marginTop: spacing.lg }]} onPress={onBack} activeOpacity={0.75}>
        <Text style={styles.ctaText}>{t('perfil.excluirConta.blockedBackCta')}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ExcluirContaScreen() {
  const { t }    = useTranslation()
  const user     = useAuthStore(s => s.user)
  const token    = useAuthStore(s => s.token)
  const logout   = useAuthStore(s => s.logout)

  const [mode, setMode]           = useState<Mode>('loading')
  const [blocks, setBlocks]       = useState<EligibilityBlocks | null>(null)
  const [checkError, setCheckError] = useState(false)

  const [pinHash, setPinHash]           = useState('')
  const [securityHash, setSecurityHash] = useState('')
  const [smsCode, setSmsCode]           = useState('')

  const [pinError, setPinError]         = useState<string | null>(null)
  const [securityError, setSecurityError] = useState<string | null>(null)
  const [smsError, setSmsError]         = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [wrongAnswer, setWrongAnswer]   = useState(false)
  const [submitting, setSubmitting]     = useState(false)

  const authHeader = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY }

  const loadStatus = React.useCallback(async () => {
    if (!token) return
    setMode('loading')
    setCheckError(false)
    try {
      const res  = await fetch(`${BFF}/conta-excluir`, { method: 'POST', headers: authHeader, body: JSON.stringify({ action: 'status' }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.code ?? 'ERROR')
      if (data.eligible) {
        setMode('aviso')
      } else {
        setBlocks(data.blocks)
        setMode('blocked')
      }
    } catch {
      setCheckError(true)
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadStatus() }, [loadStatus])

  if (!user) return null

  const headerLabel = t('perfil.excluirConta.title')

  const handleBack = () => {
    switch (mode) {
      case 'pin':      setMode('aviso');    break
      case 'security':
        setPinError(null); setMode('pin');  break
      case 'sms':      setMode('security'); break
      case 'confirm':  setMode('sms');      break
      default:         router.back()
    }
  }

  const handlePin = (hash: string) => {
    setPinHash(hash)
    setPinError(null)
    setMode('security')
  }

  const handleSecurity = async (answerHash: string) => {
    setSecurityHash(answerHash)
    setSecurityError(null)
    setSubmitting(true)
    try {
      await fetch(`${BFF}/perfil-send-sms`, { method: 'POST', headers: authHeader, body: JSON.stringify({ purpose: 'account_delete' }) })
    } catch { /* best-effort */ }
    setSubmitting(false)
    setMode('sms')
  }

  const handleSms = (code: string) => {
    setSmsCode(code)
    setSmsError(null)
    setMode('confirm')
  }

  const handleFinalConfirm = async () => {
    setSubmitting(true)
    setConfirmError(null)
    try {
      const res  = await fetch(`${BFF}/conta-excluir`, {
        method:  'POST',
        headers: authHeader,
        body: JSON.stringify({
          action:                'confirm',
          pin_hash:              pinHash,
          security_answer_hash:  securityHash,
          sms_code:              smsCode,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.code === 'INVALID_CREDENTIALS') {
          setPinError(t('perfil.excluirConta.errorPin'))
          setMode('pin')
        } else if (data.code === 'WRONG_SECURITY_ANSWER') {
          setWrongAnswer(true)
          setTimeout(() => setWrongAnswer(false), 1800)
          setMode('security')
        } else if (data.code === 'SMS_EXPIRED') {
          setSmsError(t('perfil.excluirConta.errorSmsExpired'))
          setMode('sms')
        } else if (data.code === 'SMS_INVALID') {
          setSmsError(t('perfil.excluirConta.errorSms'))
          setMode('sms')
        } else if (data.code === 'NOT_ELIGIBLE') {
          setBlocks(data.blocks)
          setMode('blocked')
        } else {
          setConfirmError(t('perfil.excluirConta.errorGeneric'))
        }
        setSubmitting(false)
        return
      }

      setSubmitting(false)
      setMode('success')
    } catch {
      setSubmitting(false)
      setConfirmError(t('perfil.excluirConta.errorGeneric'))
    }
  }

  const handleDone = async () => {
    await logout()
    router.replace('/(auth)/welcome')
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {mode !== 'success' && <Header label={headerLabel} onBack={handleBack} />}

      {mode === 'loading' && (
        <View style={styles.centerWrap}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
          <Text style={styles.loadingText}>{t('perfil.excluirConta.loadingCheck')}</Text>
          {checkError && (
            <>
              <Text style={styles.errorText}>{t('perfil.excluirConta.checkError')}</Text>
              <TouchableOpacity style={styles.cta} onPress={loadStatus} activeOpacity={0.75}>
                <Text style={styles.ctaText}>{t('perfil.dados.retry')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {mode === 'blocked' && blocks && (
        <BlockedStep blocks={blocks} onBack={() => router.back()} />
      )}

      {mode === 'aviso' && (
        <ScrollView style={styles.flex} contentContainerStyle={styles.stepWrap} showsVerticalScrollIndicator={false}>
          <Text style={styles.stepTitle}>{t('perfil.excluirConta.avisoTitle')}</Text>
          <Text style={styles.avisoBody}>{t('perfil.excluirConta.avisoBody')}</Text>
          <TouchableOpacity style={[styles.dangerCta, { marginTop: spacing.lg }]} onPress={() => setMode('pin')} activeOpacity={0.75}>
            <Text style={styles.dangerCtaText}>{t('perfil.excluirConta.avisoCta')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Text style={styles.outlineBtnText}>{t('perfil.excluirConta.avisoCancelCta')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {mode === 'pin' && (
        <View style={styles.stepWrap}>
          <Text style={styles.stepEyebrow}>{t('perfil.excluirConta.pinTitle')}</Text>
          <Text style={styles.stepTitle}>{t('perfil.excluirConta.pinSub')}</Text>
          <PINInput mode="secure" onComplete={handlePin} error={pinError} checkObvious={false} />
        </View>
      )}

      {mode === 'security' && (
        <View style={styles.flex}>
          <SecurityConfirmation
            identifier={`@${user.handle}`}
            pinHash={pinHash}
            eyebrow={t('perfil.excluirConta.securityEyebrow')}
            submitting={submitting}
            wrongAnswer={wrongAnswer}
            onPass={handleSecurity}
          />
        </View>
      )}

      {mode === 'sms' && (
        <SmsStep loading={submitting} error={smsError} onConfirm={handleSms} />
      )}

      {mode === 'confirm' && (
        <ConfirmStep loading={submitting} error={confirmError} onConfirm={handleFinalConfirm} />
      )}

      {mode === 'success' && (
        <SuccessStep onDone={handleDone} />
      )}
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  backBtn: { width: 36 },
  backIcon: { fontSize: 22, color: 'rgba(255,255,255,0.85)' },
  headerTitle: {
    fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: typography.weight.bold,
    letterSpacing: 1, textTransform: 'uppercase', fontFamily: typography.fontFamily.primary,
  },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  loadingText: { fontSize: 13, color: 'rgba(255,255,255,0.45)', fontFamily: typography.fontFamily.primary },
  stepWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 },
  stepEyebrow: {
    fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 1.1, textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary, marginBottom: 6,
  },
  stepTitle: {
    fontSize: 19, fontWeight: typography.weight.bold, color: colors.white[100],
    fontFamily: typography.fontFamily.primary, marginBottom: spacing.sm,
  },
  avisoBody: {
    fontSize: 13.5, color: 'rgba(255,255,255,0.6)', lineHeight: 20,
    fontFamily: typography.fontFamily.primary, marginBottom: spacing.md,
  },
  errorText: { fontSize: 12.5, color: colors.state.error, fontFamily: typography.fontFamily.primary, marginBottom: spacing.sm },
  smsInput: {
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 16, fontSize: 20, letterSpacing: 4,
    color: colors.white[100], fontFamily: typography.fontFamily.primary, marginBottom: spacing.lg,
  },
  cta: {
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  ctaText: { fontSize: 13, fontWeight: typography.weight.bold, color: colors.white[100], fontFamily: typography.fontFamily.primary },
  dangerCta: {
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.state.error,
  },
  dangerCtaText: { fontSize: 13, fontWeight: typography.weight.bold, color: colors.white[100], fontFamily: typography.fontFamily.primary },
  ctaDisabled: { opacity: 0.35 },
  outlineBtn: { paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  outlineBtnText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', fontFamily: typography.fontFamily.primary },
  blockCard: {
    padding: 14, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 0.5, borderColor: 'rgba(239,68,68,0.3)', marginBottom: spacing.sm, gap: 8,
  },
  blockText: { fontSize: 13, color: colors.state.error, lineHeight: 18, fontFamily: typography.fontFamily.primary },
  blockLink: { fontSize: 13, color: colors.white[100], fontWeight: typography.weight.bold, fontFamily: typography.fontFamily.primary },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.sm },
  successCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  successIcon: { fontSize: 28, color: colors.white[100] },
  successTitle: { fontSize: 19, fontWeight: typography.weight.bold, color: colors.white[100], fontFamily: typography.fontFamily.primary },
  successMsg: {
    fontSize: 13.5, color: 'rgba(255,255,255,0.55)', textAlign: 'center', lineHeight: 19,
    fontFamily: typography.fontFamily.primary, marginBottom: spacing.lg,
  },
})
