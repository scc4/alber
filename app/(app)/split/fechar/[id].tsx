// Design: /design/flows-split.jsx — SplitDetailScreen (closing=true view)
// Spec: /specs/06_modules/split.md § 5 "Fechar Split variável"
// Fluxo: alocação final → PIN → fecha e volta para a lista

import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useSplitStore } from '../../../../store/split.store'
import { useAuthStore } from '../../../../store/auth.store'
import { Header } from '../../../../components/core/Header'
import { Eyebrow } from '../../../../components/shared/Eyebrow'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { PINInput } from '../../../../components/financial/PINInput'
import { colors, spaceSkins } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'allocation' | 'pin'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SplitFecharScreen() {
  const { id }    = useLocalSearchParams<{ id: string }>()
  const { t }     = useTranslation()
  const insets    = useSafeAreaInsets()
  const token     = useAuthStore(s => s.token)
  const split      = useSplitStore(s => s.getSplitById(id))
  const closeSplit = useSplitStore(s => s.closeSplit)

  const [step, setStep]           = useState<Step>('allocation')
  const [pinError, setPinError]   = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // ── Not found / wrong type ────────────────────────────────────────────────────

  if (!split || split.type !== 'variable') {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('split.fechar.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Split não encontrado.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
            <Text style={styles.backLinkText}>{t('split.fechar.back')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const accepted        = split.participants.filter(p => p.status === 'accepted')
  const launchedAlready = split.totalLaunched
  const teto            = split.totalValue
  const remaining       = teto - launchedAlready
  const defaultEach     = accepted.length > 0 ? Math.floor(remaining / accepted.length) : 0

  // ── Allocation state ──────────────────────────────────────────────────────────

  const [allocations, setAllocations] = useState<Record<string, string>>(() =>
    Object.fromEntries(accepted.map(p => [p.id, String(defaultEach)]))
  )

  function updateAlloc(participantId: string, value: string) {
    setAllocations(a => ({ ...a, [participantId]: value.replace(/[^\d]/g, '') }))
  }

  const finalAllocTotal = accepted.reduce(
    (acc, p) => acc + (parseInt(allocations[p.id] ?? '0', 10) || 0),
    0,
  )
  const totalUsed     = launchedAlready + finalAllocTotal
  const exceeds       = totalUsed > teto
  const returnAmount  = Math.max(0, teto - totalUsed)
  const canConfirm    = !exceeds && finalAllocTotal > 0

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handlePinComplete(pin: string) {
    if (!split || !token) return
    setPinError(null)
    setSubmitting(true)
    try {
      const allocMap: Record<string, number> = {}
      accepted.forEach(p => {
        allocMap[p.id] = parseInt(allocations[p.id] ?? '0', 10) || 0
      })
      await closeSplit(split.id, allocMap, pin, token)
      router.replace('/(app)/split/')
    } catch (e) {
      setPinError(e instanceof Error ? e.message : 'Erro ao fechar split')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render: allocation step ───────────────────────────────────────────────────

  if (step === 'allocation') {
    return (
      <View style={styles.root}>
        <Header
          variant="title"
          title={t('split.fechar.title')}
          contextLabel={t('split.fechar.subtitle')}
          onBack={() => router.back()}
        />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Description */}
            <Text style={styles.description}>{t('split.fechar.description')}</Text>

            {/* Already debited via launches */}
            {launchedAlready > 0 && (
              <View style={styles.alreadyDebitedCard}>
                <Text style={styles.alreadyDebitedText}>
                  {t('split.fechar.alreadyDebited', { amount: launchedAlready })}
                </Text>
              </View>
            )}

            {/* Participant rows */}
            <View style={styles.sectionGap}>
              <Eyebrow>{t('split.fechar.subtitle')}</Eyebrow>
            </View>

            {accepted.map((p, i) => (
              <View key={p.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                <View style={[styles.avatar, { backgroundColor: avatarHue(p.handle) }]}>
                  <Text style={styles.avatarText}>{p.initials[0]}</Text>
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>{p.name}</Text>
                  <Text style={styles.rowBlocked}>
                    {t('split.fechar.blockedLabel', { amount: p.blockedAmount })}
                  </Text>
                </View>
                <TextInput
                  style={[styles.allocInput, exceeds && styles.allocInputError]}
                  value={allocations[p.id] ?? ''}
                  onChangeText={v => updateAlloc(p.id, v)}
                  keyboardType="numeric"
                  selectTextOnFocus
                  accessibilityLabel={p.name}
                />
              </View>
            ))}

            {/* Summary box */}
            <View style={styles.summaryBox}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{t('split.fechar.totalAllocated')}</Text>
                <Text style={[styles.summaryValue, exceeds && styles.summaryValueError]}>
                  {totalUsed} / {teto}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, teto > 0 ? (totalUsed / teto) * 100 : 0)}%`,
                      backgroundColor: exceeds ? colors.state.error : spaceSkins.surf.accent,
                    },
                  ]}
                />
              </View>
              {exceeds ? (
                <Text style={styles.exceedText}>
                  {t('split.fechar.exceedsBy', { over: totalUsed - teto })}
                </Text>
              ) : (
                <Text style={styles.returnText}>
                  {t('split.fechar.returnLabel')}: {returnAmount} {t('split.fechar.amountUnit')}
                </Text>
              )}
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <PrimaryButton
              label={t('split.fechar.confirmCta')}
              onPress={() => { setPinError(null); setStep('pin') }}
              state={canConfirm ? 'default' : 'disabled'}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    )
  }

  // ── Render: PIN step ──────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={t('split.fechar.title')}
        onBack={() => { setPinError(null); setStep('allocation') }}
      />
      <View style={styles.pinArea}>
        <Text style={styles.pinContext}>{t('split.fechar.pinContext')}</Text>
        <Text style={styles.pinSubtitle}>{t('split.fechar.pinSubtitle')}</Text>
        {pinError && <Text style={styles.pinErrorText}>{pinError}</Text>}
        <PINInput
          onComplete={submitting ? undefined : handlePinComplete}
          error={pinError}
          disabled={submitting}
        />
      </View>
    </View>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarHue(handle: string): string {
  const h = ((handle.charCodeAt(1) ?? 65) * 23) % 360
  return `hsl(${h}, 18%, 22%)`
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },

  // States
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
  },
  backLink: { padding: spacing.sm },
  backLinkText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
  },

  // Allocation step
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  description: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 19.5,
    marginBottom: spacing.md,
  },
  alreadyDebitedCard: {
    padding: 12,
    backgroundColor: 'rgba(91,206,201,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(91,206,201,0.25)',
    borderRadius: spacing.radius.md,
    marginBottom: spacing.md,
  },
  alreadyDebitedText: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(91,206,201,0.85)',
  },
  sectionGap: {
    marginBottom: 10,
  },

  // Participant row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  rowBorder: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  rowInfo: { flex: 1 },
  rowName: {
    fontSize: 14.5,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  rowBlocked: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  allocInput: {
    width: 80,
    textAlign: 'right',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
  },
  allocInputError: {
    borderColor: 'rgba(239,68,68,0.35)',
  },

  // Summary
  summaryBox: {
    marginTop: 20,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.md,
    gap: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
  },
  summaryValueError: {
    color: colors.state.error,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  exceedText: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
  },
  returnText: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
  },

  // Bottom CTA
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.black[100],
  },

  // PIN step
  pinArea: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  pinContext: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 10 * 0.14,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  pinSubtitle: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  pinErrorText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
  },
})
