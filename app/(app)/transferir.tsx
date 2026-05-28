// Design: /design/flow-transferir.jsx — TransferirFlow + NumpadValueScreen
// Spec: /specs/06_modules/transferir.md
// Fluxo: busca → valor (numpad nativo) → PIN scrambled → segurança → sucesso com recibo

import React, { useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
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

type Step = 'search' | 'value' | 'pin' | 'security' | 'success'

interface Recipient {
  name: string
  handle: string
  initials: string
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

const MOCK_ME = { handle: '@mayte', name: 'Mayte' }
const MOCK_BALANCE = 120 // Albers disponíveis — em produção vem do balance.store

const MOCK_RECENTS: Recipient[] = [
  { name: 'João Pedro',    handle: '@joaopedro', initials: 'JP' },
  { name: 'Ana Lima',      handle: '@analima',   initials: 'AL' },
  { name: 'Carlos Mendes', handle: '@carlos',    initials: 'CM' },
]

const MAX_ATTEMPTS = 3

// ─── Tela principal ───────────────────────────────────────────────────────────

export default function TransferirScreen() {
  const { t } = useTranslation()

  const [step, setStep]             = useState<Step>('search')
  const [query, setQuery]           = useState('')
  const [recipient, setRecipient]   = useState<Recipient | null>(null)
  const [notFound, setNotFound]     = useState(false)
  const [selfError, setSelfError]   = useState(false)
  const [amount, setAmount]         = useState(0)
  const [pinError, setPinError]     = useState<string | null>(null)
  const [pinAttempts, setPinAttempts] = useState(0)

  const handleClose = () => router.back()

  // ─── Handlers busca ──────────────────────────────────────────────────────────

  const tryFind = (q: string) => {
    const clean = q.replace('@', '').toLowerCase()
    if (clean === MOCK_ME.handle.replace('@', '').toLowerCase()) {
      setSelfError(true)
      setNotFound(false)
      return
    }
    const found = MOCK_RECENTS.find(
      r =>
        r.handle.replace('@', '').toLowerCase().includes(clean) ||
        r.name.toLowerCase().includes(clean),
    )
    if (found || /^[\d.\-]{11,}$/.test(q) || q.includes('@') || q.includes('.com')) {
      setRecipient(
        found ?? { name: 'Lucas Andrade', handle: '@lucas_a', initials: 'LA' },
      )
      setNotFound(false)
      setSelfError(false)
      setStep('value')
    } else if (clean.length >= 2) {
      setNotFound(true)
      setSelfError(false)
    }
  }

  const handleSelectRecent = (r: Recipient) => {
    setQuery(r.handle)
    setRecipient(r)
    setSelfError(false)
    setNotFound(false)
    setStep('value')
  }

  // Mock: qualquer PIN aceito — em produção envia hash ao BFF
  const handlePinComplete = (_hash: string) => {
    setPinError(null)
    setTimeout(() => setStep('security'), 300)
  }

  const handleSecurityPass = () => setStep('success')

  const handleSecurityFail = (_attemptsLeft: number) => {
    // Em produção: BFF incrementa contador
  }

  const handleSecurityBlocked = () => {
    setPinAttempts(0)
    setStep('search')
  }

  // ─── Etapa 1: Busca ──────────────────────────────────────────────────────────

  if (step === 'search') {
    return (
      <FlowShell
        subtitle={t('transferir.subtitleSearch')}
        title={t('transferir.title')}
        onClose={handleClose}
        closeLabel={t('transferir.cancel')}
      >
        <Text style={s.eyebrow}>{t('transferir.searchLabel')}</Text>
        <TextInput
          value={query}
          onChangeText={v => { setQuery(v); setNotFound(false); setSelfError(false) }}
          autoFocus
          placeholder={t('transferir.searchPlaceholder')}
          placeholderTextColor="rgba(255,255,255,0.25)"
          style={s.lineInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => query.length >= 2 && tryFind(query)}
          accessibilityLabel={t('transferir.searchLabel')}
        />

        {selfError && (
          <Text style={s.errorText}>{t('transferir.selfTransferError')}</Text>
        )}
        {notFound && !selfError && (
          <Text style={s.errorText}>{t('transferir.notFound')}</Text>
        )}

        <ScrollView
          style={s.recentScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[s.eyebrow, s.recentLabel]}>{t('transferir.recentLabel')}</Text>
          {MOCK_RECENTS.map(r => (
            <Pressable
              key={r.handle}
              onPress={() => handleSelectRecent(r)}
              style={({ pressed }) => [s.recentRow, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={r.name}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>{r.initials}</Text>
              </View>
              <View style={s.recentInfo}>
                <Text style={s.recentName}>{r.name}</Text>
                <Text style={s.recentHandle}>{r.handle}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <View style={s.spacer} />
        <PrimaryButton
          label={t('transferir.searchCta')}
          onPress={() => tryFind(query)}
          state={query.length >= 2 ? 'default' : 'disabled'}
        />
      </FlowShell>
    )
  }

  // ─── Etapa 2: Valor (numpad nativo, não scrambled) ────────────────────────────

  if (step === 'value' && recipient) {
    return (
      <NumpadValueScreen
        recipient={recipient}
        balance={MOCK_BALANCE}
        onSwap={() => setStep('search')}
        onClose={handleClose}
        closeLabel={t('transferir.back')}
        onContinue={amt => { setAmount(amt); setPinAttempts(0); setPinError(null); setStep('pin') }}
        t={t}
      />
    )
  }

  // ─── Etapa 3: PIN scrambled com recap card ────────────────────────────────────

  if (step === 'pin' && recipient) {
    return (
      <FlowShell
        subtitle={t('transferir.subtitlePin')}
        title={t('transferir.title')}
        onClose={() => setStep('value')}
        closeLabel={t('transferir.back')}
      >
        <Text style={s.pinContext}>{t('transferir.pinContext')}</Text>
        <Text style={s.pinSubtitle}>{t('transferir.pinSubtitle')}</Text>

        {/* Recap card — spec TR-04 */}
        <View style={s.recapCard}>
          <RecapRow label={t('transferir.recipientLabel')} value={recipient.handle} />
          <View style={s.recapDivider} />
          <RecapRow label={t('transferir.amountLabel')} value={`${amount} ${t('transferir.amountUnit')}`} />
          <View style={s.recapDivider} />
          <RecapRow
            label={t('transferir.feeLabel')}
            value={t('transferir.feeFree')}
            valueStyle={s.feeGreen}
          />
        </View>

        {pinAttempts > 0 && (
          <Text style={s.attemptHint}>
            {t('transferir.attempts', { n: pinAttempts + 1, max: MAX_ATTEMPTS })}
          </Text>
        )}

        <PINInput onComplete={handlePinComplete} error={pinError} />
      </FlowShell>
    )
  }

  // ─── Etapa 4: Confirmação de segurança ───────────────────────────────────────

  if (step === 'security') {
    return (
      <FlowShell
        subtitle={t('transferir.subtitleSecurity')}
        title={t('transferir.title')}
        onClose={() => setStep('pin')}
        closeLabel={t('transferir.back')}
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

  // ─── Etapa 5: Sucesso com recibo ─────────────────────────────────────────────

  if (step === 'success' && recipient) {
    const remaining = MOCK_BALANCE - amount
    return (
      <SuccessScreen
        amount={amount}
        recipient={recipient}
        remaining={remaining}
        onClose={handleClose}
        t={t}
      />
    )
  }

  return null
}

// ─── NumpadValueScreen ────────────────────────────────────────────────────────
// Teclado numérico padrão (não scrambled) — spec seção 3.2

interface NumpadProps {
  recipient: Recipient
  balance: number
  onSwap: () => void
  onClose: () => void
  closeLabel: string
  onContinue: (amount: number) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

function NumpadValueScreen({ recipient, balance, onSwap, onClose, closeLabel, onContinue, t }: NumpadProps) {
  const insets = useSafeAreaInsets()
  const [digits, setDigits] = useState('')
  const value = parseInt(digits || '0', 10)
  const tooMuch = value > balance
  const valid = value >= 1 && !tooMuch

  const press = (k: string) => {
    if (k === 'del') {
      setDigits(d => d.slice(0, -1))
    } else {
      setDigits(d => {
        const next = (d + k).replace(/^0+/, '')
        return next.length > 5 ? d : next
      })
    }
  }

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

  return (
    <View
      style={[
        s.numpadRoot,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      {/* Header */}
      <View style={s.shellHeader}>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={closeLabel}>
          <Text style={s.closeLabel}>{closeLabel}</Text>
        </Pressable>
      </View>
      <View style={s.titleBlock}>
        <Text style={s.eyebrow}>{t('transferir.subtitleValue')}</Text>
      </View>

      {/* Recipient card com swap */}
      <View style={s.recipientCard}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{recipient.initials}</Text>
        </View>
        <View style={s.recentInfo}>
          <Text style={s.recentName}>{recipient.name}</Text>
          <Text style={s.recentHandle}>{recipient.handle}</Text>
        </View>
        <TouchableOpacity
          onPress={onSwap}
          style={s.swapBtn}
          accessibilityRole="button"
          accessibilityLabel={t('transferir.swapCta')}
          activeOpacity={0.7}
        >
          <Text style={s.swapLabel}>{t('transferir.swapCta')}</Text>
        </TouchableOpacity>
      </View>

      {/* Valor grande */}
      <View style={s.amountCenter}>
        <View style={s.amountRow}>
          <Text style={[s.numpadAmount, tooMuch && s.numpadAmountError]}>
            {digits || '0'}
          </Text>
          <Text style={s.amountUnit}>{t('transferir.amountUnit')}</Text>
        </View>
        <Text style={[s.balanceHint, tooMuch && s.balanceHintError]}>
          {tooMuch
            ? t('transferir.balanceInsufficient')
            : t('transferir.balanceAvailable', { balance })}
        </Text>
      </View>

      {/* Numpad 3×4 */}
      <View style={s.numpadGrid}>
        {KEYS.map((k, i) => {
          if (!k) return <View key={i} style={s.numpadCell} />
          return (
            <TouchableOpacity
              key={i}
              onPress={() => press(k)}
              style={s.numpadCell}
              activeOpacity={0.65}
              accessibilityRole="button"
              accessibilityLabel={k === 'del' ? 'Apagar' : k}
            >
              <Text style={s.numpadKey}>{k === 'del' ? '⌫' : k}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={s.numpadBottomBtn}>
        <PrimaryButton
          label={t('transferir.continue')}
          onPress={() => onContinue(value)}
          state={valid ? 'default' : 'disabled'}
        />
      </View>
    </View>
  )
}

// ─── SuccessScreen ────────────────────────────────────────────────────────────

function SuccessScreen({
  amount,
  recipient,
  remaining,
  onClose,
  t,
}: {
  amount: number
  recipient: Recipient
  remaining: number
  onClose: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
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
          <Text style={s.checkMark}>✓</Text>
        </View>
        <Text style={s.successTitle}>
          {t('transferir.successTitle', { amount })}
        </Text>
        <Text style={s.successSubtitle}>
          {t('transferir.successSubtitle', { handle: recipient.handle })}
        </Text>

        {/* Recibo formal — spec 3.5 */}
        <View style={s.receiptCard}>
          <ReceiptRow label={t('transferir.receiptTo')}     value={recipient.handle} />
          <ReceiptRow label={t('transferir.receiptAmount')} value={`${amount} Albers`} />
          <ReceiptRow
            label={t('transferir.receiptFee')}
            value={t('transferir.receiptFeeFree')}
            green
          />
          <ReceiptRow
            label={t('transferir.receiptRemaining')}
            value={`${remaining} Albers`}
            last
          />
        </View>
      </View>
      <View style={s.successBottom}>
        <View style={s.successAsaas}>
          <AsaasBadge />
        </View>
        <PrimaryButton label={t('transferir.homeCta')} onPress={onClose} />
      </View>
    </View>
  )
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
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={closeLabel}>
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

// ─── RecapRow / ReceiptRow ────────────────────────────────────────────────────

function RecapRow({
  label,
  value,
  valueStyle,
}: {
  label: string
  value: string
  valueStyle?: object
}) {
  return (
    <View style={s.recapRow}>
      <Text style={s.recapLabel}>{label}</Text>
      <Text style={[s.recapValue, valueStyle]}>{value}</Text>
    </View>
  )
}

function ReceiptRow({
  label,
  value,
  green,
  last,
}: {
  label: string
  value: string
  green?: boolean
  last?: boolean
}) {
  return (
    <View style={[s.receiptRow, !last && s.receiptRowBorder]}>
      <Text style={s.receiptLabel}>{label}</Text>
      <Text style={[s.receiptValue, green && s.receiptValueGreen]}>{value}</Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Shell
  shell: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  shellHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  closeLabel: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    paddingVertical: spacing.sm,
  },
  titleBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
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

  // Search
  lineInput: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.18)',
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.xs,
    fontSize: 18,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  errorText: {
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
    borderRadius: spacing.radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
    fontFamily: typography.fontFamily.primary,
  },
  recentInfo: { flex: 1, minWidth: 0 },
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

  spacer: { flex: 1 },

  // Numpad root
  numpadRoot: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  recipientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.sm + 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: spacing.radius.md,
  },
  swapBtn: {
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: spacing.radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  swapLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 0.04 * 11,
  },
  amountCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  amountUnit: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
  },
  numpadAmount: {
    fontSize: 64,
    fontWeight: '700',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -0.04 * 64,
    lineHeight: 70,
    fontVariant: ['tabular-nums'],
  },
  numpadAmountError: { color: colors.state.error },
  balanceHint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
  },
  balanceHintError: { color: colors.state.error },

  // Numpad grid
  numpadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  numpadCell: {
    width: '30%',
    flexGrow: 1,
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numpadKey: {
    fontSize: 22,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  numpadBottomBtn: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },

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

  // Recap card
  recapCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: spacing.radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  recapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
  },
  recapDivider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  recapLabel: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
  },
  recapValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  feeGreen: { color: colors.state.success },
  attemptHint: {
    fontSize: typography.size.micro.fontSize,
    color: colors.warning[500],
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.md,
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
    fontSize: 26,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -0.025 * 26,
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
    lineHeight: typography.size.caption.lineHeight * 1.4,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  receiptCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.lg,
    paddingHorizontal: spacing.md,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
  },
  receiptRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.05)',
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
  receiptValueGreen: { color: colors.state.success },
  successBottom: { paddingBottom: spacing.sm },
  successAsaas: { alignItems: 'center', marginBottom: spacing.md },
})
