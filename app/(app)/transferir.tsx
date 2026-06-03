// Design: /design/flow-transferir.jsx — TransferirFlow + NumpadValueScreen
// Spec: /specs/06_modules/transferir.md
// Fluxo: busca → valor (numpad nativo) → PIN scrambled → segurança → sucesso com recibo

import React, { useState, useEffect } from 'react'
import {
  ActivityIndicator,
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
  SecurityQuestion,
} from '../../components/financial/SecurityConfirmation'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { AsaasBadge } from '../../components/shared/AsaasBadge'
import { useAuthStore } from '../../store/auth.store'
import { useBalanceStore } from '../../store/balance.store'
import { transferir, TransferirResponse } from '../../services/financial.service'
import { formatAlbers } from '../../utils/format'
import { maskAlbers } from '../../utils/currency'
import { BffError } from '../../services/auth.service'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Step = 'search' | 'value' | 'pin' | 'security' | 'processing' | 'success'

interface Recipient {
  name: string
  handle: string
  initials: string
}

// ─── BFF ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const BFF_URL      = SUPABASE_URL + '/functions/v1'
const ANON_KEY     = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

const MAX_ATTEMPTS = 3

// ─── Tela principal ───────────────────────────────────────────────────────────

export default function TransferirScreen() {
  const { t } = useTranslation()
  const { user, token } = useAuthStore()
  const { balance, fetchBalance } = useBalanceStore()

  const [step, setStep]             = useState<Step>('search')
  const [query, setQuery]           = useState('')
  const [recipient, setRecipient]   = useState<Recipient | null>(null)
  const [notFound, setNotFound]     = useState(false)
  const [selfError, setSelfError]   = useState(false)
  const [amount, setAmount]         = useState(0)
  const [pinHash, setPinHash]       = useState<string | null>(null)
  const [pinError, setPinError]     = useState<string | null>(null)
  const [apiError, setApiError]     = useState<string | null>(null)
  const [pinAttempts, setPinAttempts] = useState(0)
  const [transferirResult, setTransferirResult] = useState<TransferirResponse | null>(null)
  const [recents, setRecents]               = useState<Recipient[]>([])
  const [recentsLoading, setRecentsLoading] = useState(true)
  const [securityQuestions, setSecurityQuestions] = useState<SecurityQuestion[]>([])

  useEffect(() => {
    if (!token || !user?.id) return
    ;(async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/security_questions?user_id=eq.${user.id}&select=question&order=position.asc`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) return
        const rows: { question: string }[] = await res.json()
        if (Array.isArray(rows) && rows.length > 0) {
          setSecurityQuestions(rows.map(r => ({ question: r.question })))
        }
      } catch { /* silencioso — SecurityConfirmation usa mock */ }
    })()
  }, [token, user?.id])

  useEffect(() => {
    if (!token) { setRecentsLoading(false); return }
    ;(async () => {
      try {
        const params = new URLSearchParams({ tipo: 'out', page: '0', limit: '20' })
        const res = await fetch(`${BFF_URL}/financial-atividade?${params}`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const json = await res.json()
        const rows: Array<{ type: string; counterpart: { name: string; handle: string } | null }> = json.data ?? []
        const seen = new Set<string>()
        const list: Recipient[] = []
        for (const row of rows) {
          if (row.type !== 'enviar' || !row.counterpart?.handle) continue
          const h = row.counterpart.handle
          if (seen.has(h)) continue
          seen.add(h)
          const name = row.counterpart.name || h.replace('@', '')
          const initials = name.split(' ').map((p: string) => p[0]).slice(0, 2).join('').toUpperCase()
          list.push({ name, handle: h, initials })
          if (list.length >= 5) break
        }
        setRecents(list)
      } catch { /* silencioso */ } finally {
        setRecentsLoading(false)
      }
    })()
  }, [token])

  const handleClose = () => router.back()

  // ─── Handlers busca ──────────────────────────────────────────────────────────

  const tryFind = (q: string) => {
    const clean = q.trim()
    if (clean.length < 2) return
    const myHandle = user?.handle?.replace('@', '').toLowerCase()
    const inputHandle = clean.replace('@', '').toLowerCase()
    if (myHandle && inputHandle === myHandle) {
      setSelfError(true)
      setNotFound(false)
      return
    }
    const found = recents.find(
      r =>
        r.handle.replace('@', '').toLowerCase().includes(inputHandle) ||
        r.name.toLowerCase().includes(inputHandle),
    )
    const resolved = found ?? {
      name:     clean,
      handle:   clean.startsWith('@') ? clean : '',
      initials: clean.replace('@', '').slice(0, 2).toUpperCase(),
    }
    setRecipient(resolved)
    if (found) setQuery(found.handle) // normaliza query para o handle completo
    setNotFound(false)
    setSelfError(false)
    setApiError(null)
    setStep('value')
  }

  const handleSelectRecent = (r: Recipient) => {
    setQuery(r.handle)
    setRecipient(r)
    setSelfError(false)
    setNotFound(false)
    setApiError(null)
    setStep('value')
  }

  const handlePinComplete = (hash: string) => {
    setPinHash(hash)
    setPinError(null)
    setApiError(null)
    setTimeout(() => setStep('security'), 300)
  }

  const handleSecurityPass = async (answerHash?: string) => {
    if (!answerHash || !pinHash || !token || !recipient) return
    setStep('processing')
    try {
      const result = await transferir(token, query, amount, pinHash, answerHash)
      setTransferirResult(result)
      await fetchBalance()
      setStep('success')
    } catch (e) {
      if (e instanceof BffError) {
        if (e.code === 'RECIPIENT_NOT_FOUND' || e.code === 'SELF_TRANSFER') {
          setApiError(
            e.code === 'SELF_TRANSFER'
              ? t('transferir.selfTransferError')
              : t('transferir.errorRecipientNotFound'),
          )
          setStep('search')
        } else if (e.code === 'INSUFFICIENT_BALANCE') {
          setApiError(t('transferir.errorInsufficient'))
          setStep('value')
        } else if (e.code === 'INVALID_CREDENTIALS') {
          setPinError(t('transferir.errorInvalidCredentials'))
          setPinHash(null)
          setStep('pin')
        } else if (e.code === 'TOO_MANY_ATTEMPTS') {
          setApiError(t('transferir.errorTooManyAttempts'))
          setStep('search')
        } else {
          setApiError(t('transferir.errorApi'))
          setStep('search')
        }
      } else {
        setApiError(t('transferir.errorApi'))
        setStep('search')
      }
    }
  }

  const handleSecurityFail = (_attemptsLeft: number) => {
    // BFF incrementa contador internamente — nenhuma ação local necessária
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
        {apiError && !selfError && !notFound && (
          <Text style={s.errorText}>{apiError}</Text>
        )}

        <ScrollView
          style={s.recentScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[s.eyebrow, s.recentLabel]}>{t('transferir.recentLabel')}</Text>
          {recentsLoading
            ? <ActivityIndicator size="small" color="rgba(255,255,255,0.3)" style={s.recentsSpinner} />
            : recents.length === 0
              ? <Text style={s.recentEmpty}>{t('transferir.recentEmpty')}</Text>
              : recents.map(r => (
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
              ))
          }
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
        balance={balance}
        onSwap={() => setStep('search')}
        onClose={handleClose}
        closeLabel={t('transferir.back')}
        apiError={apiError}
      onContinue={amt => { setAmount(amt); setPinAttempts(0); setPinError(null); setApiError(null); setStep('pin') }}
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
          <RecapRow label={t('transferir.amountLabel')} value={`${formatAlbers(amount)} ${t('transferir.amountUnit')}`} />
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
          questions={securityQuestions.length ? securityQuestions : undefined}
          onPass={handleSecurityPass}
          onFail={handleSecurityFail}
          onBlocked={handleSecurityBlocked}
        />
      </FlowShell>
    )
  }

  // ─── Etapa 4.5: Processando ──────────────────────────────────────────────────

  if (step === 'processing') {
    return (
      <FlowShell
        subtitle={t('transferir.processing')}
        title={t('transferir.title')}
        onClose={() => {}}
        closeLabel=""
      >
        <View style={s.processingCenter}>
          <ActivityIndicator color={colors.white[100]} size="large" />
        </View>
      </FlowShell>
    )
  }

  // ─── Etapa 5: Sucesso com recibo ─────────────────────────────────────────────

  if (step === 'success' && recipient) {
    const remaining = transferirResult?.novo_saldo ?? balance
    return (
      <SuccessScreen
        amount={transferirResult?.amount ?? amount}
        recipient={{ ...recipient, handle: transferirResult?.destinatario_handle ?? recipient.handle }}
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
  apiError?: string | null
  onSwap: () => void
  onClose: () => void
  closeLabel: string
  onContinue: (amount: number) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

function NumpadValueScreen({ recipient, balance, apiError, onSwap, onClose, closeLabel, onContinue, t }: NumpadProps) {
  const insets = useSafeAreaInsets()
  const [digits, setDigits] = useState('')
  const value = parseInt(digits || '0', 10) / 100
  const tooMuch = value > balance
  const valid = value >= 1 && !tooMuch

  const press = (k: string) => {
    if (k === 'del') {
      setDigits(d => d.slice(0, -1))
    } else {
      setDigits(d => {
        const next = (d + k).replace(/^0+/, '')
        return next.length > 7 ? d : next
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
            {digits ? maskAlbers(digits) : '0,00'}
          </Text>
          <Text style={s.amountUnit}>{t('transferir.amountUnit')}</Text>
        </View>
        <Text style={[s.balanceHint, (tooMuch || apiError) && s.balanceHintError]}>
          {tooMuch
            ? t('transferir.balanceInsufficient')
            : apiError
              ? apiError
              : t('transferir.balanceAvailable', { balance: formatAlbers(balance) })}
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
          {t('transferir.successTitle', { amount: formatAlbers(amount) })}
        </Text>
        <Text style={s.successSubtitle}>
          {t('transferir.successSubtitle', { handle: recipient.handle })}
        </Text>

        {/* Recibo formal — spec 3.5 */}
        <View style={s.receiptCard}>
          <ReceiptRow label={t('transferir.receiptTo')}     value={recipient.handle} />
          <ReceiptRow label={t('transferir.receiptAmount')} value={`${formatAlbers(amount)} Albers`} />
          <ReceiptRow
            label={t('transferir.receiptFee')}
            value={t('transferir.receiptFeeFree')}
            green
          />
          <ReceiptRow
            label={t('transferir.receiptRemaining')}
            value={`${formatAlbers(remaining)} Albers`}
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

  recentsSpinner: { marginTop: spacing.md },
  recentEmpty: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: typography.fontFamily.primary,
    marginTop: spacing.md,
  },
  spacer: { flex: 1 },
  processingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
