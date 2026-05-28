// Design: /design/flows1.jsx — ReceberFlow
// Spec: /specs/06_modules/receber.md
// Fluxo: valor → identificar pagador → confirmar → PIN scrambled → segurança → sucesso

import React, { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { PINInput } from '../../components/financial/PINInput'
import {
  SecurityConfirmation,
  MOCK_SECURITY_QUESTIONS,
} from '../../components/financial/SecurityConfirmation'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { AsaasBadge } from '../../components/shared/AsaasBadge'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Step = 'value' | 'identify' | 'payer' | 'pin' | 'security' | 'insufficient' | 'success'

interface Payer {
  name: string
  handle: string
  maskedCpf: string
  initials: string
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

const MOCK_ME = { handle: '@mayte', name: 'Mayte' }

const MOCK_RECENTS: Payer[] = [
  { name: 'João Silva Pereira', handle: '@joaosilva', maskedCpf: '***.***.789-01', initials: 'JS' },
  { name: 'Ana Maria Costa',   handle: '@ana_costa',  maskedCpf: '***.***.234-56', initials: 'AC' },
  { name: 'Pedro Henrique',    handle: '@phenrique',  maskedCpf: '***.***.012-34', initials: 'PH' },
]

// Saldo mock do pagador — em produção vem do BFF após PIN válido
const MOCK_PAYER_BALANCE = 200
const MAX_ATTEMPTS = 3

// ─── Tela principal ───────────────────────────────────────────────────────────

export default function ReceberScreen() {
  const { t } = useTranslation()

  const [step, setStep]               = useState<Step>('value')
  const [amount, setAmount]           = useState('')
  const [identifier, setIdentifier]   = useState('')
  const [searching, setSearching]     = useState(false)
  const [notFound, setNotFound]       = useState(false)
  const [payer, setPayer]             = useState<Payer | null>(null)
  const [pinError, setPinError]       = useState<string | null>(null)
  const [pinAttempts, setPinAttempts] = useState(0)

  const amountNum = parseInt(amount || '0', 10)

  const handleClose = () => router.back()

  const handleSearch = () => {
    if (!identifier.trim()) return
    setSearching(true)
    setTimeout(() => {
      setSearching(false)
      const q = identifier.replace('@', '').toLowerCase()
      const found = MOCK_RECENTS.find(
        p =>
          p.handle.replace('@', '').toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q),
      )
      if (found || /^\d{3}/.test(identifier) || identifier.includes('@') || q.length >= 3) {
        setPayer(
          found ?? { name: 'Lucas Andrade', handle: '@lucas_a', maskedCpf: '***.***.567-89', initials: 'LA' },
        )
        setNotFound(false)
        setStep('payer')
      } else {
        setNotFound(true)
      }
    }, 400)
  }

  const handleSelectRecent = (p: Payer) => {
    setIdentifier(p.handle)
    setPayer(p)
    setStep('payer')
  }

  // Mock: qualquer PIN aceito — em produção envia hash ao BFF para validação
  const handlePinComplete = (_hash: string) => {
    setPinError(null)
    setTimeout(() => setStep('security'), 300)
  }

  const handleSecurityPass = () => {
    if (MOCK_PAYER_BALANCE >= amountNum) {
      setStep('success')
    } else {
      setStep('insufficient')
    }
  }

  const handleSecurityFail = (_attemptsLeft: number) => {
    // Em produção: BFF incrementa contador e pode bloquear a conta
  }

  const handleSecurityBlocked = () => {
    setStep('value') // reset para recomeçar
  }

  // ─── Etapa 1: Valor ──────────────────────────────────────────────────────────

  if (step === 'value') {
    return (
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <FlowShell
          subtitle={t('receber.subtitleValue')}
          title={t('receber.title')}
          onClose={handleClose}
          closeLabel={t('receber.cancel')}
        >
          <Text style={s.eyebrow}>{t('receber.amountLabel')}</Text>
          <View style={s.amountRow}>
            <TextInput
              value={amount}
              onChangeText={v => setAmount(v.replace(/[^\d]/g, ''))}
              keyboardType="number-pad"
              autoFocus
              style={s.amountInput}
              maxLength={6}
              placeholder="0"
              placeholderTextColor="rgba(255,255,255,0.2)"
              accessibilityLabel={t('receber.amountLabel')}
            />
            <Text style={s.amountUnit}>{t('receber.amountUnit')}</Text>
          </View>
          <View style={s.rule} />
          <Text style={s.disclaimer}>{t('receber.valueDisclaimer')}</Text>
          <View style={s.spacer} />
          <PrimaryButton
            label={t('receber.continue')}
            onPress={() => setStep('identify')}
            state={amountNum >= 1 ? 'default' : 'disabled'}
          />
        </FlowShell>
      </KeyboardAvoidingView>
    )
  }

  // ─── Etapa 2: Identificar pagador ────────────────────────────────────────────

  if (step === 'identify') {
    return (
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <FlowShell
          subtitle={t('receber.subtitleIdentify')}
          title={t('receber.title')}
          onClose={() => setStep('value')}
          closeLabel={t('receber.back')}
        >
          <Text style={s.eyebrow}>{t('receber.identifierLabel')}</Text>
          <TextInput
            value={identifier}
            onChangeText={v => { setIdentifier(v); setNotFound(false) }}
            autoFocus
            placeholder={t('receber.identifierPlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.25)"
            style={s.lineInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            accessibilityLabel={t('receber.identifierLabel')}
          />
          {notFound && (
            <Text style={s.notFoundText}>{t('receber.notFound')}</Text>
          )}

          <ScrollView
            style={s.recentScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[s.eyebrow, s.recentLabel]}>{t('receber.recentLabel')}</Text>
            {MOCK_RECENTS.map(p => (
              <Pressable
                key={p.handle}
                onPress={() => handleSelectRecent(p)}
                style={({ pressed }) => [s.recentRow, pressed && s.pressed]}
                accessibilityRole="button"
                accessibilityLabel={p.name}
              >
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{p.initials}</Text>
                </View>
                <View style={s.recentInfo}>
                  <Text style={s.recentName}>{p.name}</Text>
                  <Text style={s.recentHandle}>{p.handle}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>

          <View style={s.spacer} />
          <PrimaryButton
            label={searching ? t('receber.searching') : t('receber.searchCta')}
            onPress={handleSearch}
            state={
              searching ? 'loading'
              : identifier.trim().length >= 1 ? 'default'
              : 'disabled'
            }
          />
        </FlowShell>
      </KeyboardAvoidingView>
    )
  }

  // ─── Etapa 3: Confirmar pagador ──────────────────────────────────────────────

  if (step === 'payer' && payer) {
    return (
      <FlowShell
        subtitle={t('receber.subtitleConfirm')}
        title={t('receber.title')}
        onClose={() => setStep('identify')}
        closeLabel={t('receber.back')}
      >
        <Text style={s.eyebrow}>{t('receber.collectingFrom')}</Text>
        <View style={s.payerCard}>
          <View style={s.avatarLarge}>
            <Text style={s.avatarLargeText}>{payer.initials}</Text>
          </View>
          <View style={s.payerInfo}>
            <Text style={s.payerName}>{payer.name}</Text>
            <Text style={s.payerMeta}>
              {payer.handle} · {payer.maskedCpf}
            </Text>
          </View>
        </View>

        <View style={s.amountSummaryBlock}>
          <Text style={s.eyebrow}>{t('receber.amountSummary')}</Text>
          <View style={s.amountRow}>
            <Text style={s.amountBig}>{amountNum}</Text>
            <Text style={s.amountUnit}>{t('receber.amountUnit')}</Text>
          </View>
        </View>

        <View style={s.spacer} />
        <Text style={s.disclaimer}>{t('receber.payerDisclaimer')}</Text>
        <View style={{ height: spacing.md }} />
        <PrimaryButton
          label={t('receber.requestCta')}
          onPress={() => { setPinAttempts(0); setPinError(null); setStep('pin') }}
        />
      </FlowShell>
    )
  }

  // ─── Etapa 4: PIN scrambled do pagador ───────────────────────────────────────

  if (step === 'pin' && payer) {
    return (
      <FlowShell
        subtitle={t('receber.subtitlePin')}
        title={t('receber.title')}
        onClose={() => setStep('payer')}
        closeLabel={t('receber.back')}
      >
        <Text style={s.pinContext}>{t('receber.pinContext')}</Text>
        <Text style={s.pinSubtitle}>{t('receber.pinSubtitle')}</Text>

        <View style={s.pinCard}>
          <View style={s.pinCardRow}>
            <Text style={s.pinCardLabel}>{t('receber.pinContextPayer')}</Text>
            <Text style={s.pinCardValue}>{payer.name}</Text>
          </View>
          <View style={s.pinCardDivider} />
          <View style={s.pinCardRow}>
            <Text style={s.pinCardLabel}>{t('receber.amountSummary')}</Text>
            <Text style={s.pinCardValue}>
              {amountNum} {t('receber.amountUnit')}
            </Text>
          </View>
        </View>

        {pinAttempts > 0 && (
          <Text style={s.attemptHint}>
            {t('receber.attempts', { n: pinAttempts + 1, max: MAX_ATTEMPTS })}
          </Text>
        )}

        <PINInput onComplete={handlePinComplete} error={pinError} />
      </FlowShell>
    )
  }

  // ─── Etapa 5: Confirmação de segurança ───────────────────────────────────────

  if (step === 'security') {
    return (
      <FlowShell
        subtitle={t('receber.subtitleSecurity')}
        title={t('receber.title')}
        onClose={() => setStep('pin')}
        closeLabel={t('receber.back')}
      >
        <SecurityConfirmation
          questions={MOCK_SECURITY_QUESTIONS}
          onPass={handleSecurityPass}
          onFail={handleSecurityFail}
          onBlocked={handleSecurityBlocked}
        />
      </FlowShell>
    )
  }

  // ─── Etapa 6: Saldo insuficiente ─────────────────────────────────────────────

  if (step === 'insufficient') {
    const missing = amountNum - MOCK_PAYER_BALANCE
    return (
      <FlowShell
        subtitle={t('receber.subtitleInsufficient')}
        title={t('receber.title')}
        onClose={handleClose}
        closeLabel={t('receber.cancel')}
      >
        <View style={s.insufficientBlock}>
          <ReceiptRow
            label={t('receber.insufficientCurrent')}
            value={`${MOCK_PAYER_BALANCE} ${t('receber.amountUnit')}`}
          />
          <ReceiptRow
            label={t('receber.insufficientNeeded')}
            value={`${amountNum} ${t('receber.amountUnit')}`}
          />
          <ReceiptRow
            label={t('receber.insufficientMissing')}
            value={`${missing} ${t('receber.amountUnit')}`}
            accent
          />
        </View>
        <View style={s.spacer} />
        <PrimaryButton
          label={t('receber.insufficientBack')}
          onPress={() => setStep('value')}
          variant="ghost"
        />
      </FlowShell>
    )
  }

  // ─── Etapa 7: Sucesso ────────────────────────────────────────────────────────

  if (step === 'success' && payer) {
    return (
      <SuccessScreen
        title={t('receber.successTitle', { amount: amountNum })}
        rows={[
          { label: t('receber.successFrom'), value: payer.handle },
          { label: t('receber.successTo'),   value: MOCK_ME.handle },
        ]}
        ctaLabel={t('receber.conclude')}
        onCta={handleClose}
      />
    )
  }

  return null
}

// ─── FlowShell ────────────────────────────────────────────────────────────────

interface FlowShellProps {
  subtitle: string
  title: string
  onClose: () => void
  closeLabel: string
  children: React.ReactNode
}

function FlowShell({ subtitle, title, onClose, closeLabel, children }: FlowShellProps) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        s.shell,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      <View style={s.shellHeader}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        >
          <Text style={s.closeLabel}>{closeLabel}</Text>
        </Pressable>
      </View>
      <View style={s.titleBlock}>
        <Text style={s.eyebrow}>{subtitle}</Text>
        <Text style={s.titleText}>{title}</Text>
      </View>
      <View style={s.content}>{children}</View>
    </View>
  )
}

// ─── SuccessScreen ────────────────────────────────────────────────────────────

interface SuccessRow { label: string; value: string }

function SuccessScreen({
  title,
  rows,
  ctaLabel,
  onCta,
}: {
  title: string
  rows: SuccessRow[]
  ctaLabel: string
  onCta: () => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        s.successRoot,
        { paddingTop: insets.top + spacing.xl, paddingBottom: Math.max(insets.bottom, spacing.xl) },
      ]}
    >
      <View style={s.successBody}>
        <View style={s.checkCircle}>
          {/* Checkmark SVG inline — sem dependência extra */}
          <Text style={s.checkMark}>✓</Text>
        </View>
        <Text style={s.successTitle}>{title}</Text>
        <View style={s.successCard}>
          {rows.map((row, i) => (
            <ReceiptRow
              key={i}
              label={row.label}
              value={row.value}
              last={i === rows.length - 1}
            />
          ))}
        </View>
      </View>
      <View style={s.successBottom}>
        <View style={s.successAsaas}>
          <AsaasBadge />
        </View>
        <PrimaryButton label={ctaLabel} onPress={onCta} />
      </View>
    </View>
  )
}

// ─── ReceiptRow ───────────────────────────────────────────────────────────────

function ReceiptRow({
  label,
  value,
  accent,
  last,
}: {
  label: string
  value: string
  accent?: boolean
  last?: boolean
}) {
  return (
    <View style={[s.receiptRow, !last && s.receiptRowBorder]}>
      <Text style={s.receiptLabel}>{label}</Text>
      <Text style={[s.receiptValue, accent && s.receiptValueAccent]}>{value}</Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  flex: { flex: 1 },

  // Shell
  shell: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  shellHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  closeLabel: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    paddingVertical: spacing.sm,
  },
  titleBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  titleText: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -0.025 * 28,
    fontFamily: typography.fontFamily.primary,
    marginTop: spacing.xs,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },

  // Eyebrow
  eyebrow: {
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: typography.eyebrow.textTransform,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.xs,
  },

  // Amount input
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  amountInput: {
    fontSize: 54,
    fontWeight: '700',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -0.04 * 54,
    padding: 0,
    minWidth: 60,
    maxWidth: 220,
    fontVariant: ['tabular-nums'],
  },
  amountUnit: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
  },
  amountBig: {
    fontSize: 42,
    fontWeight: '700',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -0.04 * 42,
  },

  // Separator
  rule: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: spacing.md,
  },

  // Disclaimer
  disclaimer: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: typography.size.caption.lineHeight,
  },

  spacer: { flex: 1 },

  // Identifier input
  lineInput: {
    width: '100%',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.18)',
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.xs,
    fontSize: 18,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.md,
  },
  notFoundText: {
    fontSize: typography.size.caption.fontSize,
    color: colors.state.error,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },

  // Recents
  recentScroll: { flex: 1 },
  recentLabel: { marginTop: spacing.md },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  pressed: { opacity: 0.6 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    fontFamily: typography.fontFamily.primary,
  },
  recentInfo: { flex: 1 },
  recentName: {
    fontSize: typography.size.bodySmall.fontSize,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  recentHandle: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    marginTop: 2,
  },

  // Payer card
  payerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: spacing.radius.lg,
    padding: spacing.md + 2,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  avatarLarge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLargeText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  payerInfo: { flex: 1 },
  payerName: {
    fontSize: typography.size.h2.fontSize,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  payerMeta: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
    marginTop: 2,
  },

  // Amount summary
  amountSummaryBlock: { marginBottom: spacing.lg },

  // PIN step
  pinContext: {
    fontSize: typography.size.bodySmall.fontSize,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  pinSubtitle: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.md,
  },
  pinCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: spacing.radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  pinCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
  },
  pinCardDivider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  pinCardLabel: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
  },
  pinCardValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  attemptHint: {
    fontSize: typography.size.micro.fontSize,
    color: colors.warning[500],
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.md,
  },

  // Insufficient
  insufficientBlock: {
    marginTop: spacing.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: spacing.radius.md,
    paddingHorizontal: spacing.md,
  },

  // Success
  successRoot: {
    flex: 1,
    backgroundColor: colors.black[100],
    paddingHorizontal: spacing.lg,
  },
  successBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(34,197,94,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  checkMark: {
    fontSize: 28,
    color: colors.state.success,
    fontFamily: typography.fontFamily.primary,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -0.02 * 24,
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  successCard: {
    width: '100%',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.lg,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: spacing.md,
  },
  successBottom: { paddingBottom: spacing.sm },
  successAsaas: { alignItems: 'center', marginBottom: spacing.md },

  // Receipt row (shared entre success e insufficient)
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
  },
  receiptRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  receiptLabel: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
  },
  receiptValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  receiptValueAccent: {
    color: colors.warning[500],
  },
})
