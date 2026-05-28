// Design: /design/flows1.jsx — CarregarFlow + FlowShell + SuccessScreen
// Spec: /specs/06_modules/carregar_descarregar.md
// Tela unificada: Carregar (QR Pix) | Descarregar (Pix saída)
// Mock ativo para Sprint 2 — integração Supabase/Asaas no Sprint 3

import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { Eyebrow } from '../../components/shared/Eyebrow'
import { QRCodeDisplay } from '../../components/financial/QRCodeDisplay'
import { AsaasBadge } from '../../components/shared/AsaasBadge'
import { useAuthStore } from '../../store/auth.store'
import { useBalanceStore } from '../../store/balance.store'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Tab  = 'carregar' | 'descarregar'
type Step =
  | 'kyc_blocked'
  | 'value'
  | 'qr'
  | 'confirm'
  | 'pin'
  | 'security'
  | 'success'

// ─── Helpers monetários ───────────────────────────────────────────────────────

function formatBRL(digits: string): string {
  const n = parseInt(digits || '0', 10)
  const reais = Math.floor(n / 100)
  const cents = n % 100
  return `${reais.toLocaleString('pt-BR')},${String(cents).padStart(2, '0')}`
}

function parseBRL(digits: string): number {
  return parseInt(digits || '0', 10) / 100
}

const FEE = 0.5 // taxa fixa mock Descarregar — substituir pelo cálculo real no Sprint 3

// ─── Tela principal ───────────────────────────────────────────────────────────

export default function CarregarScreen() {
  const { t } = useTranslation()
  const { kycStatus, user } = useAuthStore()
  const { balance, fetchBalance } = useBalanceStore()

  const [tab, setTab]           = useState<Tab>('carregar')
  const [step, setStep]         = useState<Step>(
    kycStatus !== 'approved' ? 'kyc_blocked' : 'value',
  )
  const [rawAmount, setRawAmount] = useState('10000') // centavos, default R$100,00
  const [pinError, setPinError]   = useState<string | null>(null)
  const pinKey = useRef(0)

  const numericAmount = parseBRL(rawAmount)
  const isValidCarregar    = numericAmount >= 5
  const isValidDescarregar = numericAmount >= 10 && numericAmount <= balance

  const isValid = tab === 'carregar' ? isValidCarregar : isValidDescarregar

  const handleRawInput = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 9) // máx ~R$9.999.999
    setRawAmount(digits)
  }

  const handleShortcut = (reais: number) => {
    setRawAmount(String(reais * 100))
  }

  const handleTabChange = (t: Tab) => {
    setTab(t)
    setRawAmount('10000')
  }

  const handleCarregarSuccess = async () => {
    await fetchBalance()
    setStep('success')
  }

  const handleDescarregarSuccess = async () => {
    await fetchBalance()
    setStep('success')
  }

  const handlePINComplete = (_hash: string) => {
    // Produção: enviar hash + contexto para BFF validar
    setPinError(null)
    setTimeout(() => setStep('security'), 200)
  }

  const handleSecurityPass = () => {
    // Mock: simula processamento bem-sucedido
    setTimeout(() => handleDescarregarSuccess(), 400)
  }

  const handleSecurityBlocked = () => {
    setPinError(t('auth.security.blocked'))
    setStep('value')
  }

  const handleDone = () => {
    router.back()
  }

  // ── KYC bloqueado ──────────────────────────────────────────────────────────
  if (step === 'kyc_blocked') {
    return (
      <FlowShell
        title={t('carregar.kycBlockedTitle')}
        subtitle=""
        onClose={() => router.back()}
      >
        <Text style={s.kycBody}>{t('carregar.kycBlockedBody')}</Text>
        <View style={s.spacer} />
        <PrimaryButton
          label={t('carregar.kycBlockedCta')}
          onPress={() => router.push('/(auth)/cadastro/dados' as never)}
        />
      </FlowShell>
    )
  }

  // ── Seleção de valor ───────────────────────────────────────────────────────
  if (step === 'value') {
    return (
      <FlowShell
        title={tab === 'carregar' ? t('carregar.tabCarregar') : t('carregar.tabDescarregar')}
        subtitle={t('carregar.subtitleValue')}
        onClose={() => router.back()}
      >
        {/* Seletor de aba */}
        <View style={s.tabBar}>
          {(['carregar', 'descarregar'] as Tab[]).map(tb => (
            <Pressable
              key={tb}
              onPress={() => handleTabChange(tb)}
              style={[s.tabBtn, tab === tb && s.tabBtnActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === tb }}
            >
              <Text style={[s.tabLabel, tab === tb && s.tabLabelActive]}>
                {tb === 'carregar' ? t('carregar.tabCarregar') : t('carregar.tabDescarregar')}
              </Text>
            </Pressable>
          ))}
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            {/* Input de valor */}
            <Eyebrow>{t('carregar.amountLabel')}</Eyebrow>
            <View style={s.amountRow}>
              <Text style={s.amountCurrency}>R$</Text>
              <TextInput
                value={formatBRL(rawAmount)}
                onChangeText={handleRawInput}
                keyboardType="numeric"
                autoFocus
                style={s.amountInput}
                selectionColor={colors.white[100]}
                accessibilityLabel={t('carregar.amountLabel')}
              />
            </View>

            {/* Atalhos */}
            <Eyebrow style={{ marginBottom: 10 }}>{t('carregar.shortcutsLabel')}</Eyebrow>
            <View style={s.shortcuts}>
              {[20, 50, 100, 200].map(v => (
                <Pressable
                  key={v}
                  onPress={() => handleShortcut(v)}
                  style={s.shortcutBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`R$ ${v}`}
                >
                  <Text style={s.shortcutText}>R$ {v}</Text>
                </Pressable>
              ))}
            </View>

            {/* Aviso contextual */}
            <View style={s.warningBox}>
              <Text style={s.warningText}>
                {tab === 'carregar'
                  ? t('carregar.warningCarregar')
                  : t('carregar.warningDescarregar')}
              </Text>
            </View>

            {/* Info descarregar: saldo disponível */}
            {tab === 'descarregar' && (
              <View style={s.balanceHint}>
                <Text style={s.balanceHintText}>
                  Disponível: {balance} Albers (R$ {balance.toFixed(2).replace('.', ',')})
                </Text>
              </View>
            )}

            <View style={s.spacer} />
          </ScrollView>
        </KeyboardAvoidingView>

        <PrimaryButton
          label={tab === 'carregar' ? t('carregar.generateQr') : t('carregar.continue')}
          onPress={() => setStep(tab === 'carregar' ? 'qr' : 'confirm')}
          state={isValid ? 'default' : 'disabled'}
        />
      </FlowShell>
    )
  }

  // ── QR Code (Carregar) ─────────────────────────────────────────────────────
  if (step === 'qr') {
    return (
      <FlowShell
        title={t('carregar.tabCarregar')}
        subtitle={t('carregar.subtitleQr')}
        onClose={() => router.back()}
        onBack={() => setStep('value')}
      >
        <View style={s.qrAmountHeader}>
          <Text style={s.qrAmountLabel}>{t('carregar.qr.valueLabel')}</Text>
          <Text style={s.qrAmountValue}>R$ {formatBRL(rawAmount)}</Text>
        </View>

        <QRCodeDisplay
          cpfMasked={user?.cpfMasked ?? '***.***.***-**'}
          onExpire={() => setStep('value')}
          onGenerateNew={() => {
            // Mock: volta para seleção de valor para gerar novo QR
            setStep('value')
          }}
        />

        <View style={s.qrActions}>
          <Pressable style={s.ghostBtn} accessibilityRole="button">
            <Text style={s.ghostBtnText}>{t('carregar.qr.copyCode')}</Text>
          </Pressable>
          <Pressable style={s.ghostBtn} accessibilityRole="button">
            <Text style={s.ghostBtnText}>{t('carregar.qr.share')}</Text>
          </Pressable>
        </View>

        <View style={s.pixNoteWrap}>
          <Text style={s.pixNoteText}>{t('carregar.pixNote')}</Text>
          <AsaasBadge />
        </View>

        <View style={s.spacer} />
        <PrimaryButton
          label={t('carregar.cancel')}
          variant="ghost"
          onPress={() => router.back()}
        />
      </FlowShell>
    )
  }

  // ── Confirmação (Descarregar) ──────────────────────────────────────────────
  if (step === 'confirm') {
    const net = numericAmount - FEE
    return (
      <FlowShell
        title={t('carregar.tabDescarregar')}
        subtitle={t('carregar.subtitleConfirm')}
        onClose={() => router.back()}
        onBack={() => setStep('value')}
      >
        <View style={s.confirmRows}>
          <ConfirmRow label={t('carregar.confirm.amountLabel')}
            value={`R$ ${formatBRL(rawAmount)}`} />
          <ConfirmRow label={t('carregar.confirm.feeLabel')}
            value={`−R$ ${FEE.toFixed(2).replace('.', ',')}`} muted />
          <ConfirmRow label={t('carregar.confirm.netLabel')}
            value={`R$ ${net.toFixed(2).replace('.', ',')}`} bold />
          <ConfirmRow label={t('carregar.confirm.keyLabel')}
            value={user?.pixKey ?? '—'} muted />
        </View>

        <View style={s.spacer} />
        <View style={s.asaasWrap}>
          <AsaasBadge />
        </View>
        <PrimaryButton
          label={t('carregar.continue')}
          onPress={() => {
            pinKey.current += 1
            setStep('pin')
          }}
        />
      </FlowShell>
    )
  }

  // ── PIN scrambled (Descarregar) ────────────────────────────────────────────
  if (step === 'pin') {
    return (
      <FlowShell
        title={t('carregar.tabDescarregar')}
        subtitle="Confirmar PIN"
        onClose={() => router.back()}
        onBack={() => setStep('confirm')}
      >
        <View style={s.pinContext}>
          <Text style={s.pinContextValue}>R$ {formatBRL(rawAmount)}</Text>
          <Text style={s.pinContextLabel}>Para {user?.pixKey ?? '—'}</Text>
        </View>

        <PINInput
          key={`descarregar-pin-${pinKey.current}`}
          onComplete={handlePINComplete}
          error={pinError}
        />
      </FlowShell>
    )
  }

  // ── Confirmação de segurança (Descarregar) ─────────────────────────────────
  if (step === 'security') {
    return (
      <FlowShell
        title={t('carregar.tabDescarregar')}
        subtitle="Confirmação de segurança"
        onClose={() => router.back()}
        onBack={() => setStep('pin')}
      >
        <SecurityConfirmation
          questions={MOCK_SECURITY_QUESTIONS}
          onPass={handleSecurityPass}
          onBlocked={handleSecurityBlocked}
        />
      </FlowShell>
    )
  }

  // ── Sucesso ────────────────────────────────────────────────────────────────
  if (step === 'success') {
    const isCarregar = tab === 'carregar'
    return (
      <SuccessScreen
        title={
          isCarregar
            ? t('carregar.successCarregar', { amount: formatBRL(rawAmount) })
            : t('carregar.successDescarregar', { amount: formatBRL(rawAmount) })
        }
        detail={
          isCarregar
            ? t('carregar.successDetailCarregar')
            : t('carregar.successDetailDescarregar')
        }
        onClose={handleDone}
        ctaLabel={t('carregar.conclude')}
      />
    )
  }

  return null
}

// ─── FlowShell ────────────────────────────────────────────────────────────────

interface FlowShellProps {
  title: string
  subtitle: string
  onClose: () => void
  onBack?: () => void
  children: React.ReactNode
}

function FlowShell({ title, subtitle, onClose, onBack, children }: FlowShellProps) {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  return (
    <View style={[s.shell, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      {/* Barra de topo */}
      <Pressable
        onPress={onBack ?? onClose}
        style={s.shellClose}
        accessibilityRole="button"
        accessibilityLabel={onBack ? t('carregar.back') : t('carregar.cancel')}
      >
        <Text style={s.shellCloseText}>
          {onBack ? `‹ ${t('carregar.back')}` : `✕ ${t('carregar.cancel')}`}
        </Text>
      </Pressable>

      {/* Cabeçalho do flow */}
      <View style={s.shellHeader}>
        {subtitle !== '' && <Eyebrow>{subtitle}</Eyebrow>}
        <Text style={s.shellTitle}>{title}</Text>
      </View>

      {/* Conteúdo */}
      <View style={s.shellContent}>{children}</View>
    </View>
  )
}

// ─── SuccessScreen ────────────────────────────────────────────────────────────

interface SuccessScreenProps {
  title: string
  detail: string
  ctaLabel: string
  onClose: () => void
}

function SuccessScreen({ title, detail, ctaLabel, onClose }: SuccessScreenProps) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        s.successRoot,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.xl) },
      ]}
    >
      {/* Ícone de check */}
      <View style={s.successIcon}>
        <Text style={s.successCheck}>✓</Text>
      </View>

      <Text style={s.successTitle}>{title}</Text>
      <Text style={s.successDetail}>{detail}</Text>

      <View style={s.successCta}>
        <PrimaryButton label={ctaLabel} onPress={onClose} />
      </View>
    </View>
  )
}

// ─── ConfirmRow ───────────────────────────────────────────────────────────────

interface ConfirmRowProps {
  label: string
  value: string
  muted?: boolean
  bold?: boolean
}

function ConfirmRow({ label, value, muted, bold }: ConfirmRowProps) {
  return (
    <View style={s.confirmRow}>
      <Text style={s.confirmLabel}>{label}</Text>
      <Text style={[s.confirmValue, muted && s.confirmMuted, bold && s.confirmBold]}>
        {value}
      </Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // FlowShell
  shell: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  shellClose: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  shellCloseText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
  },
  shellHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: 0,
    gap: 4,
  },
  shellTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -0.7,
    fontFamily: typography.fontFamily.primary,
    marginTop: 6,
  },
  shellContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 28,
    paddingBottom: spacing.xl,
  },
  spacer: { flex: 1, minHeight: spacing.xl },

  // KYC
  kycBody: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 22,
    fontFamily: typography.fontFamily.primary,
    marginTop: spacing.sm,
  },

  // Tab selector
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: spacing.radius.md,
    padding: 3,
    marginBottom: spacing.xl,
    gap: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: spacing.radius.sm + 2,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.white[100],
    opacity: 0.55,
    fontFamily: typography.fontFamily.primary,
  },
  tabLabelActive: {
    opacity: 1,
  },

  // Amount input
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 14,
    marginBottom: spacing.lg,
  },
  amountCurrency: {
    fontSize: 34,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
    fontWeight: '400',
  },
  amountInput: {
    flex: 1,
    fontSize: 48,
    fontWeight: '700',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -1.44,
    padding: 0,
    fontVariant: ['tabular-nums'],
  },

  // Shortcuts
  shortcuts: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.md,
  },
  shortcutBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
  },
  shortcutText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },

  // Warning box
  warningBox: {
    padding: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(245,158,11,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.18)',
    borderRadius: spacing.radius.md,
    marginTop: spacing.sm,
  },
  warningText: {
    fontSize: 11.5,
    color: 'rgba(245,158,11,0.85)',
    lineHeight: 16,
    fontFamily: typography.fontFamily.primary,
  },

  // Balance hint (descarregar)
  balanceHint: {
    marginTop: spacing.sm,
    alignItems: 'flex-end',
  },
  balanceHintText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: typography.fontFamily.primary,
  },

  // QR screen
  qrAmountHeader: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  qrAmountLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1,
    fontFamily: typography.fontFamily.primary,
  },
  qrAmountValue: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -0.96,
    marginTop: 4,
    fontFamily: typography.fontFamily.primary,
  },
  qrActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: spacing.md,
  },
  ghostBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
  },
  ghostBtnText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 0.2,
  },
  pixNoteWrap: {
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  pixNoteText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 0.2,
  },
  asaasWrap: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },

  // Confirm screen
  confirmRows: {
    gap: 0,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  confirmLabel: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
  },
  confirmValue: {
    fontSize: 14,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
    fontFamily: typography.fontFamily.primary,
  },
  confirmMuted: {
    color: 'rgba(255,255,255,0.55)',
  },
  confirmBold: {
    fontSize: 16,
    fontWeight: '600',
  },

  // PIN context
  pinContext: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  pinContextValue: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -0.96,
    fontFamily: typography.fontFamily.primary,
    fontVariant: ['tabular-nums'],
  },
  pinContextLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 4,
    fontFamily: typography.fontFamily.primary,
  },

  // Success
  successRoot: {
    flex: 1,
    backgroundColor: colors.black[100],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(34,197,94,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successCheck: {
    fontSize: 28,
    color: colors.state.success,
    fontWeight: '300',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -0.48,
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: typography.fontFamily.primary,
  },
  successDetail: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: typography.fontFamily.primary,
  },
  successCta: {
    position: 'absolute',
    bottom: 36,
    left: spacing.lg,
    right: spacing.lg,
  },
})
