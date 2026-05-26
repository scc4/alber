// Design: /design/flows-rest.jsx — EventCard
// Spec: /specs/06_modules/alber_lounge.md § 9 "Comprar ingresso"
// Exibe: nome, data, tipo, lote ativo, progress de ocupação
// Badges: "ÚLTIMAS VAGAS" (≤10% capacidade), "ESGOTADO", recorrência, visibilidade

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { BatchBadge } from './BatchBadge'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventBatchType = 'quantity' | 'date'
export type EventBatchStatus = 'pending' | 'active' | 'sold_out' | 'expired'
export type EventVisibility = 'members_only' | 'public'

export interface EventBatch {
  id:          string
  name:        string
  batchNumber: number
  batchType:   EventBatchType
  priceBrl:    number
  priceAlbers: number
  capacity:    number
  sold:        number
  validUntil:  string | null
  status:      EventBatchStatus
}

export interface LoungeEvent {
  id:           string
  loungeId:     string
  name:         string
  description:  string
  imageUri:     string | null
  date:         string
  visibility:   EventVisibility
  isPaid:       boolean
  isRecurring:  boolean
  recurrenceFreq: 'daily' | 'weekly' | 'biweekly' | 'monthly' | null
  batches:      EventBatch[]
  totalCapacity: number
  confirmed:    number
  status:       'active' | 'cancelled'
  createdAt:    string
}

interface Props {
  event:     LoungeEvent
  accent:    string
  isManager?: boolean
  onPress:   () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getActiveBatch(event: LoungeEvent): EventBatch | null {
  if (!event.isPaid || event.batches.length === 0) return null
  return event.batches.find(b => b.status === 'active') ?? event.batches[event.batches.length - 1]
}

export function isSoldOut(event: LoungeEvent): boolean {
  if (!event.isPaid) return false
  const active = getActiveBatch(event)
  if (!active) return true
  return active.status === 'sold_out' || active.sold >= active.capacity
}

function isLastTickets(event: LoungeEvent): boolean {
  const active = getActiveBatch(event)
  if (!active || isSoldOut(event)) return false
  const remaining = active.capacity - active.sold
  return remaining <= Math.ceil(active.capacity * 0.1)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventCard({ event, accent, isManager = false, onPress }: Props) {
  const { t }        = useTranslation()
  const activeBatch  = getActiveBatch(event)
  const soldOut      = isSoldOut(event)
  const lastTickets  = isLastTickets(event)
  const fillPct      = event.totalCapacity > 0
    ? Math.min(100, (event.confirmed / event.totalCapacity) * 100)
    : 0

  const isPaidBorder = event.isPaid && !soldOut
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(255,255,255,0.07)'

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.card, { borderColor: isPaidBorder }]}
      accessibilityRole="button"
      accessibilityLabel={event.name}
    >
      {/* Name + price */}
      <View style={styles.topRow}>
        <Text style={styles.name} numberOfLines={2}>{event.name}</Text>
        <Text style={[styles.price, { color: event.isPaid ? colors.white[100] : accent }]}>
          {event.isPaid && activeBatch
            ? `${activeBatch.priceAlbers} A`
            : t('lounge.eventFree')}
        </Text>
      </View>

      {/* Active batch info */}
      {activeBatch && !soldOut && (
        <Text style={[styles.batchInfo, { color: accent }]}>
          {activeBatch.name}
          {activeBatch.validUntil
            ? ` · ${t('lounge.batchUntil', { date: activeBatch.validUntil })}`
            : ''}
          {' · '}{t('lounge.batchRemaining', { n: activeBatch.capacity - activeBatch.sold })}
        </Text>
      )}

      {/* Date + badges row */}
      <View style={styles.bottomRow}>
        <Text style={styles.date}>{event.date}</Text>
        <View style={styles.badges}>
          {event.isRecurring && event.recurrenceFreq && (
            <View style={[styles.pill, { borderColor: `${accent}55` }]}>
              <Text style={[styles.pillText, { color: accent }]}>
                {t(`lounge.criarEvento.freq${capitalize(event.recurrenceFreq)}`)}
              </Text>
            </View>
          )}
          {(lastTickets || soldOut) && (
            <BatchBadge
              status={soldOut ? 'sold-out' : 'last-tickets'}
              accent={accent}
            />
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

      {/* Occupancy bar */}
      {event.totalCapacity > 0 && (
        <>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${fillPct}%`,
                  backgroundColor: soldOut ? colors.state.error : accent,
                },
              ]}
            />
          </View>
          <Text style={styles.confirmados}>
            {t('lounge.eventConfirmados', { n: event.confirmed, total: event.totalCapacity })}
          </Text>
        </>
      )}

      {/* Manager CTA */}
      {isManager && (
        <Text style={[styles.manageCta, { color: accent }]}>GERENCIAR ›</Text>
      )}
    </TouchableOpacity>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderRadius: 12,
    gap: 5,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 1,
  },
  name: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  price: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    flexShrink: 0,
  },
  batchInfo: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 10.5 * 0.04,
    fontWeight: '500',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 3,
  },
  date: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
    flexShrink: 0,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  pill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 0.5,
  },
  pillText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 9 * 0.08,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  pillMuted: {
    paddingHorizontal: 5,
    paddingVertical: 1,
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
  progressTrack: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: 7,
  },
  progressFill: {
    height: '100%',
    borderRadius: 1,
  },
  confirmados: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 4,
  },
  manageCta: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 10 * 0.08,
    fontWeight: '600',
    marginTop: 6,
    textTransform: 'uppercase',
  },
})
