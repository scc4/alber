// Design: /design/flows-split.jsx — participant list inside SplitDetailScreen
// States: pending, accepted, declined, insufficient-balance

import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SplitParticipant } from '../../store/split.store'
import { formatAlbers } from '../../utils/format'
import { colors, spaceSkins } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Types ────────────────────────────────────────────────────────────────────

type DisplayStatus = SplitParticipant['status'] | 'declined' | 'insufficient-balance'

const STATUS_COLOR: Record<DisplayStatus, string> = {
  'accepted':             colors.state.success,
  'pending':              colors.warning[500],
  'declined':             colors.state.error,
  'insufficient-balance': colors.warning[600],
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  participant: SplitParticipant
  /** Overrides participant.status for declined/insufficient-balance states */
  statusOverride?: 'declined' | 'insufficient-balance'
  /** Shows "VOCÊ" badge */
  isMe?: boolean
  /** Shows "NOVO" badge (recalculation context) */
  isNew?: boolean
  /** Shows blocked amount when participant is accepted */
  isVariable?: boolean
  showTopBorder?: boolean
}

export function ParticipantRow({
  participant,
  statusOverride,
  isMe = false,
  isNew = false,
  isVariable = false,
  showTopBorder = true,
}: Props) {
  const { t } = useTranslation()

  const status: DisplayStatus = statusOverride ?? participant.status
  const statusColor = STATUS_COLOR[status]

  const statusLabel = {
    accepted:             t('split.statusParticipantAccepted'),
    pending:              t('split.statusParticipantPending'),
    declined:             t('split.statusParticipantDeclined'),
    'insufficient-balance': t('split.statusParticipantInsufficient'),
  }[status]

  return (
    <View style={[styles.row, showTopBorder && styles.topBorder]}>
      {/* Avatar */}
      <View style={styles.avatar}>
        <Text style={styles.avatarLetter}>
          {(participant.initials ?? participant.name)[0]}
        </Text>
      </View>

      {/* Name + handle */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{participant.name}</Text>
          {isMe && (
            <View style={styles.meBadge}>
              <Text style={styles.meBadgeText}>{t('split.ownerBadge')}</Text>
            </View>
          )}
          {isNew && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>{t('split.newBadge')}</Text>
            </View>
          )}
        </View>
        <Text style={styles.handle}>{participant.handle}</Text>
      </View>

      {/* Status + blocked amount */}
      <View style={styles.statusCol}>
        <Text style={[styles.statusText, { color: statusColor }]}>
          {statusLabel}
        </Text>
        {status === 'accepted' && isVariable && participant.blockedAmount > 0 && (
          <Text style={styles.blocked}>
            {t('split.blockedAmount', { amount: formatAlbers(participant.blockedAmount) })}
          </Text>
        )}
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  topBorder: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },

  // Avatar
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarLetter: {
    fontSize: 13,
    fontWeight: typography.weight.bold,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },

  // Info column
  info: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  name: {
    fontSize: 14.5,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  handle: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 1,
  },

  // "VOCÊ" badge
  meBadge: {
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  meBadgeText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 9 * 0.1,
  },

  // "NOVO" badge
  newBadge: {
    backgroundColor: 'rgba(91,206,201,0.15)',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  newBadgeText: {
    fontSize: 9,
    fontWeight: typography.weight.bold,
    fontFamily: typography.fontFamily.primary,
    color: spaceSkins.surf.accent,
    letterSpacing: 9 * 0.08,
  },

  // Status column
  statusCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  statusText: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
  },
  blocked: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
})
