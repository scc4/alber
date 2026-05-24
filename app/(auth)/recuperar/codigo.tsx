// Design: /design/auth-login.jsx — ForgotCode
// Spec: /specs/05_security.md seção 5 — código 6 dígitos via SMS ou email
// Válido 10 minutos, uso único. Reenvio disponível após 60 segundos.

import { useEffect, useRef, useState } from 'react'
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type Channel = 'sms' | 'email' | null

// Mock: dados mascarados do usuário
const MOCK_SMS   = '(**) *****-3421'
const MOCK_EMAIL = 'ma***@gm***.com'

function ForgotShell({
  step, title, subtitle, onBack, children, footer,
}: {
  step: number; title: string; subtitle?: string
  onBack: () => void; children: React.ReactNode; footer?: React.ReactNode
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
        <View style={s.body}>{children}</View>
        {footer ? <View style={s.footer}>{footer}</View> : null}
      </View>
    </View>
  )
}

export default function CodigoScreen() {
  const { t } = useTranslation()
  const [channel, setChannel] = useState<Channel>(null)
  const [code, setCode] = useState(['','','','','',''])
  const [resendIn, setResendIn] = useState(60)
  const inputRefs = useRef<(TextInput | null)[]>([])

  useEffect(() => {
    if (!channel) return
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn(r => r - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn, channel])

  const setDigit = (i: number, v: string) => {
    v = v.replace(/\D/g, '').slice(-1)
    const next = [...code]; next[i] = v; setCode(next)
    if (v && i < 5) inputRefs.current[i + 1]?.focus()
  }

  const onKey = (i: number, key: string) => {
    if (key === 'Backspace' && !code[i] && i > 0) {
      inputRefs.current[i - 1]?.focus()
    }
  }

  const isFilled = code.every(d => d.length === 1)

  // ─── Escolha de canal ─────────────────────────────────────────────────────
  if (!channel) {
    return (
      <ForgotShell
        step={2}
        title={t('auth.recovery.step2Channel.title')}
        subtitle={t('auth.recovery.step2Channel.subtitle')}
        onBack={() => router.back()}
      >
        <View style={s.channelList}>
          {([
            { id: 'sms' as Channel,   icon: '📱', label: t('auth.recovery.step2Channel.sms'),   dest: MOCK_SMS },
            { id: 'email' as Channel, icon: '✉️',  label: t('auth.recovery.step2Channel.email'), dest: MOCK_EMAIL },
          ] as const).map(ch => (
            <TouchableOpacity
              key={ch.id!}
              style={s.channelBtn}
              onPress={() => { setChannel(ch.id); setResendIn(60) }}
              activeOpacity={0.7}
            >
              <View style={s.channelIcon}>
                <Text style={{ fontSize: 18 }}>{ch.icon}</Text>
              </View>
              <View style={s.channelInfo}>
                <Text style={s.channelLabel}>{ch.label}</Text>
                <Text style={s.channelDest}>{ch.dest}</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ForgotShell>
    )
  }

  // ─── Inserção do código ────────────────────────────────────────────────────
  const dest = channel === 'sms' ? MOCK_SMS : MOCK_EMAIL
  return (
    <ForgotShell
      step={2}
      title={t('auth.recovery.step2Code.title')}
      subtitle={t('auth.recovery.step2Code.subtitle', { dest })}
      onBack={() => setChannel(null)}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={() => router.push('/(auth)/recuperar/novo-pin')}
          state={isFilled ? 'default' : 'disabled'}
        />
      }
    >
      {/* Inputs dos 6 dígitos */}
      <View style={s.codeRow}>
        {code.map((d, i) => (
          <TextInput
            key={i}
            ref={el => { inputRefs.current[i] = el }}
            value={d}
            onChangeText={v => setDigit(i, v)}
            onKeyPress={({ nativeEvent }) => onKey(i, nativeEvent.key)}
            keyboardType="numeric"
            maxLength={1}
            selectTextOnFocus
            selectionColor={colors.white[100]}
            style={[s.codeInput, d ? s.codeInputFilled : null]}
          />
        ))}
      </View>

      <Text style={s.resend}>
        {resendIn > 0 ? (
          t('auth.recovery.step2Code.resendIn', { s: resendIn })
        ) : (
          <Text
            onPress={() => setResendIn(60)}
            style={s.resendActive}
          >
            {t('auth.recovery.step2Code.resend')}
          </Text>
        )}
      </Text>
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
  body: { flex: 1 },
  footer: { paddingVertical: spacing.md, paddingBottom: spacing.lg },
  // channel
  channelList: { gap: 10 },
  channelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 18, backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: spacing.radius.md,
  },
  channelIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  channelInfo: { flex: 1 },
  channelLabel: {
    fontSize: 14, color: colors.white[100], fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
  },
  channelDest: {
    fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2,
    fontFamily: typography.fontFamily.primary,
  },
  chevron: { color: 'rgba(255,255,255,0.3)', fontSize: 20 },
  // code
  codeRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 18,
  },
  codeInput: {
    flex: 1, height: 54, textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 11, color: colors.white[100],
    fontSize: 22, fontWeight: '600', fontFamily: typography.fontFamily.primary,
  },
  codeInputFilled: { borderColor: 'rgba(255,255,255,0.4)' },
  resend: {
    textAlign: 'center', fontSize: 12.5,
    color: 'rgba(255,255,255,0.5)', fontFamily: typography.fontFamily.primary,
  },
  resendActive: { color: colors.white[100], textDecorationLine: 'underline' },
})
