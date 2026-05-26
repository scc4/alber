// Design: /design/flows-rest.jsx — EventCard + compra de ingresso
// Spec: /specs/06_modules/alber_lounge.md § 9.2 "Comprar ingresso" e § 9.3 "Ingresso confirmado"
// Fluxo: detalhe → PIN (pago) → confirmação

import { useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useLoungeStore } from '../../../../store/lounge.store'
import { useBalanceStore } from '../../../../store/balance.store'
import { getActiveBatch, isSoldOut } from '../../../../components/lounge/EventCard'
import { BatchBadge } from '../../../../components/lounge/BatchBadge'
import { PINInput } from '../../../../components/financial/PINInput'
import { AlberLogo } from '../../../../components/core/AlberLogo'
import { Header } from '../../../../components/core/Header'
import { Eyebrow } from '../../../../components/shared/Eyebrow'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { colors } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'detail' | 'pin' | 'confirmed'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EventoScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>()
  const { t }   = useTranslation()
  const insets  = useSafeAreaInsets()

  const getEventById = useLoungeStore(s => s.getEventById)
  const buyTicket    = useLoungeStore(s => s.buyTicket)
  const balance      = useBalanceStore(s => s.balance)

  const found = getEventById(id)

  const [step, setStep]         = useState<Step>('detail')
  const [pinError, setPinError] = useState<string | null>(null)

  // ── Not found ─────────────────────────────────────────────────────────────────

  if (!found) {
    return (
      <View style={styles.root}>
        <Header variant="title" title="Evento" onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Evento não encontrado.</Text>
        </View>
      </View>
    )
  }

  const { event, lounge } = found
  const activeBatch = getActiveBatch(event)
  const soldOut     = isSoldOut(event)
  const remaining   = activeBatch ? activeBatch.capacity - activeBatch.sold : 0
  const lastTickets = activeBatch && !soldOut && remaining <= Math.ceil(activeBatch.capacity * 0.1)
  const fillPct     = event.totalCapacity > 0
    ? Math.min(100, (event.confirmed / event.totalCapacity) * 100)
    : 0

  const hasSufficientBalance = activeBatch
    ? balance >= activeBatch.priceAlbers
    : false

  const accent = lounge.accent

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleFreeTicket() {
    buyTicket(event.id, '')
    setStep('confirmed')
  }

  function handlePinComplete() {
    if (!activeBatch) return
    buyTicket(event.id, activeBatch.id)
    setStep('confirmed')
  }

  // ── Step: PIN ─────────────────────────────────────────────────────────────────

  if (step === 'pin') {
    return (
      <View style={styles.root}>
        <Header
          variant="title"
          title={t('lounge.criarEvento.title')}
          onBack={() => { setPinError(null); setStep('detail') }}
        />
        <View style={styles.pinArea}>
          <Text style={styles.pinContext}>{t('lounge.evento.pinContext')}</Text>
          <Text style={styles.pinSubtitle}>{t('lounge.evento.pinSubtitle')}</Text>
          {pinError && <Text style={styles.pinErrorText}>{pinError}</Text>}
          <PINInput onComplete={handlePinComplete} error={pinError} />
        </View>
      </View>
    )
  }

  // ── Step: Confirmed ───────────────────────────────────────────────────────────

  if (step === 'confirmed') {
    return (
      <View style={styles.root}>
        <View style={[styles.confirmedRoot, { paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom + 24, spacing.xl) }]}>
          {/* Ticket card */}
          <View style={[styles.ticketCard, { borderColor: `${accent}33` }]}>
            {/* Accent glow strip */}
            <View style={[styles.ticketStrip, { backgroundColor: accent }]} />

            <View style={styles.ticketContent}>
              {/* Logo */}
              <View style={styles.ticketLogo}>
                <AlberLogo size={28} />
              </View>

              {/* Title */}
              <Text style={styles.confirmedTitle}>{t('lounge.evento.confirmTitle')}</Text>

              {/* Divider */}
              <View style={styles.ticketDivider}>
                <View style={styles.ticketDividerCircleL} />
                <View style={styles.ticketDividerLine} />
                <View style={styles.ticketDividerCircleR} />
              </View>

              {/* Details */}
              <View style={styles.ticketRows}>
                <TicketRow label={t('lounge.evento.confirmEvent')} value={event.name} />
                <TicketRow label={t('lounge.evento.confirmDate')}  value={event.date} />
                <TicketRow label={t('lounge.evento.confirmLounge')} value={lounge.name} />
                {activeBatch && (
                  <TicketRow label={t('lounge.evento.confirmBatch')} value={activeBatch.name} />
                )}
                <TicketRow
                  label={t('lounge.evento.confirmValue')}
                  value={
                    event.isPaid && activeBatch
                      ? `${activeBatch.priceAlbers} A (R$ ${activeBatch.priceBrl})`
                      : t('lounge.evento.confirmFree')
                  }
                  accent={accent}
                />
              </View>
            </View>
          </View>

          {/* CTA */}
          <TouchableOpacity
            onPress={() => router.replace(`/(app)/lounge/${lounge.id}`)}
            style={styles.backToLoungeBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.backToLoungeText}>{t('lounge.evento.backToLounge')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Step: Detail ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={event.name}
        contextLabel={lounge.name}
        onBack={() => router.back()}
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 80, spacing.xl + 80) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Event meta */}
        <View style={styles.metaRow}>
          <Text style={styles.dateText}>{event.date}</Text>
          <View style={styles.badges}>
            {event.isRecurring && event.recurrenceFreq && (
              <View style={[styles.pill, { borderColor: `${accent}55` }]}>
                <Text style={[styles.pillText, { color: accent }]}>
                  {t('lounge.evento.recurringBadge', { freq: event.recurrenceFreq })}
                </Text>
              </View>
            )}
            <View style={styles.pillMuted}>
              <Text style={styles.pillMutedText}>
                {event.visibility === 'members_only'
                  ? t('lounge.eventVisMembers')
                  : t('lounge.eventVisAll')}
              </Text>
            </View>
          </View>
        </View>

        {/* Description */}
        {event.description.length > 0 && (
          <Text style={styles.description}>{event.description}</Text>
        )}

        {/* Active batch */}
        {event.isPaid && (
          <View style={styles.batchSection}>
            <Eyebrow>{t('lounge.evento.batchSection')}</Eyebrow>
            {activeBatch ? (
              <View style={[styles.batchCard, { borderColor: soldOut ? 'rgba(255,255,255,0.08)' : `${accent}33` }]}>
                <View style={styles.batchTopRow}>
                  <View>
                    <Text style={styles.batchName}>{activeBatch.name}</Text>
                    {activeBatch.validUntil && (
                      <Text style={styles.batchUntil}>
                        {t('lounge.batchUntil', { date: activeBatch.validUntil })}
                      </Text>
                    )}
                  </View>
                  <View style={styles.batchPriceCol}>
                    <Text style={styles.batchPriceAlbers}>{activeBatch.priceAlbers} A</Text>
                    <Text style={styles.batchPriceBrl}>R$ {activeBatch.priceBrl}</Text>
                  </View>
                </View>

                <View style={styles.batchBottomRow}>
                  <Text style={[styles.batchRemaining, { color: lastTickets ? accent : 'rgba(255,255,255,0.45)' }]}>
                    {soldOut
                      ? t('lounge.batchSoldOut')
                      : t('lounge.batchRemaining', { n: remaining })}
                  </Text>
                  {(lastTickets || soldOut) && (
                    <BatchBadge
                      status={soldOut ? 'sold-out' : 'last-tickets'}
                      accent={accent}
                    />
                  )}
                </View>
              </View>
            ) : (
              <Text style={styles.noBatchText}>{t('lounge.batchSoldOut')}</Text>
            )}
          </View>
        )}

        {/* Occupancy bar */}
        {event.totalCapacity > 0 && (
          <View style={styles.occupancyWrap}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${fillPct}%`, backgroundColor: soldOut ? colors.state.error : accent },
                ]}
              />
            </View>
            <Text style={styles.confirmados}>
              {t('lounge.eventConfirmados', { n: event.confirmed, total: event.totalCapacity })}
            </Text>
          </View>
        )}

        {/* Insufficient balance hint */}
        {event.isPaid && !soldOut && activeBatch && !hasSufficientBalance && (
          <View style={styles.insufficientCard}>
            <Text style={styles.insufficientText}>{t('lounge.evento.insufficientHint')}</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {soldOut || (!event.isPaid && !activeBatch && event.totalCapacity > 0 && event.confirmed >= event.totalCapacity) ? (
          <PrimaryButton
            label={t('lounge.evento.soldOutCta')}
            onPress={() => {}}
            state="disabled"
          />
        ) : !event.isPaid ? (
          <PrimaryButton
            label={t('lounge.evento.freeCta')}
            onPress={handleFreeTicket}
          />
        ) : !hasSufficientBalance ? (
          <PrimaryButton
            label={t('lounge.evento.insufficientCta')}
            onPress={() => router.push('/(app)/carregar')}
          />
        ) : (
          <PrimaryButton
            label={t('lounge.evento.paidCta', {
              price: activeBatch?.priceBrl ?? 0,
              albers: activeBatch?.priceAlbers ?? 0,
            })}
            onPress={() => { setPinError(null); setStep('pin') }}
          />
        )}
      </View>
    </View>
  )
}

// ─── Sub-component ────────────────────────────────────────────────────────────

function TicketRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={ticketRow.wrap}>
      <Text style={ticketRow.label}>{label}</Text>
      <Text style={[ticketRow.value, accent ? { color: accent } : undefined]}>{value}</Text>
    </View>
  )
}

const ticketRow = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  label: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
    flexShrink: 0,
  },
  value: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
    color: colors.white[100],
    textAlign: 'right',
    flex: 1,
  },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },

  // Detail
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    flexWrap: 'wrap',
    gap: 8,
  },
  dateText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 0.5,
  },
  pillText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    letterSpacing: 9 * 0.08,
    textTransform: 'uppercase',
  },
  pillMuted: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  pillMutedText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 9 * 0.08,
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 21,
    marginBottom: spacing.md,
  },

  // Batch
  batchSection: { marginTop: 20 },
  batchCard: {
    marginTop: 10,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderRadius: 12,
    gap: 10,
  },
  batchTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  batchName: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  batchUntil: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  batchPriceCol: { alignItems: 'flex-end' },
  batchPriceAlbers: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
  },
  batchPriceBrl: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  batchBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  batchRemaining: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
  },
  noBatchText: {
    marginTop: 10,
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },

  // Occupancy
  occupancyWrap: { marginTop: 20 },
  progressTrack: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1,
  },
  confirmados: {
    marginTop: 5,
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
  },

  // Insufficient balance
  insufficientCard: {
    marginTop: 14,
    padding: 11,
    backgroundColor: 'rgba(239,68,68,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: 9,
  },
  insufficientText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(239,68,68,0.85)',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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

  // Confirmation
  confirmedRoot: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  ticketCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderRadius: 16,
    overflow: 'hidden',
  },
  ticketStrip: {
    height: 4,
    width: '100%',
    opacity: 0.8,
  },
  ticketContent: {
    padding: 20,
    gap: 16,
  },
  ticketLogo: {
    alignItems: 'center',
    marginBottom: 4,
  },
  confirmedTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    textAlign: 'center',
    letterSpacing: -20 * 0.01,
  },
  ticketDivider: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ticketDividerCircleL: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.black[100],
    marginLeft: -26,
  },
  ticketDividerLine: {
    flex: 1,
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 6,
  },
  ticketDividerCircleR: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.black[100],
    marginRight: -26,
  },
  ticketRows: { gap: 0 },

  // Back to lounge
  backToLoungeBtn: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    width: '100%',
  },
  backToLoungeText: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },

  // Error state
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
  },
})
