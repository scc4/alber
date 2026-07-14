// Design: /design/flows-split.jsx — SplitCard
// Variants: active-fixed, active-variable, closed (expired/closed)

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Split } from '../../store/split.store'
import { colors, spaceSkins } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function avatarBg(handle: string): string {
  const h = ((handle.charCodeAt(1) ?? 65) * 23) % 360
  return hslToHex(h, 18, 22)
}

function formatStatus(split: Split, t: ReturnType<typeof useTranslation>['t']): string | null {
  if (split.status === 'closed')  return t('split.statusClosed')
  if (split.status === 'expired') return t('split.statusExpired')
  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  split: Split
  onPress: () => void
}

export function SplitCard({ split, onPress }: Props) {
  const { t } = useTranslation()

  const isFixed = split.type === 'fixed'
  const isClosed = split.status !== 'active'
  const accent = isFixed ? spaceSkins.tech.accent : spaceSkins.surf.accent
  const accentBorder = isFixed
    ? 'rgba(125,163,224,0.3)'
    : 'rgba(91,206,201,0.3)'

  const accepted = split.participants.filter(p => p.status === 'accepted').length
  const total    = split.participantCount
  const progress = total > 0 ? accepted / total : 0

  const valueDisplay = isFixed
    ? Math.ceil(split.totalValue / split.participantCount)
    : split.totalValue

  const valueSuffix = t(isFixed ? 'split.eachPays' : 'split.totalTarget')
  const valuePrefix = isFixed ? '' : `${t('split.upTo')} `
  const statusLabel = formatStatus(split, t)

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.card, isClosed && styles.cardClosed]}
    >
      {/* Row 1: type badge + status */}
      <View style={styles.badgeRow}>
        <View style={[styles.typeBadge, { borderColor: accentBorder }]}>
          <Text style={[styles.typeText, { color: accent }]}>
            {t(isFixed ? 'split.typeFixed' : 'split.typeVariable')}
          </Text>
        </View>
        {statusLabel && <Text style={styles.expiry}>{statusLabel}</Text>}
      </View>

      {/* Row 2: split name */}
      <Text style={styles.name} numberOfLines={1}>{split.name}</Text>

      {/* Row 3: avatar stack + value */}
      <View style={styles.bottomRow}>
        <View style={styles.avatarStack}>
          {split.participants.slice(0, 4).map((p, i) => (
            <View
              key={p.id}
              style={[
                styles.avatar,
                { backgroundColor: avatarBg(p.handle), marginLeft: i === 0 ? 0 : -6 },
              ]}
            >
              <Text style={styles.avatarLetter}>{(p.initials ?? p.name)[0]}</Text>
            </View>
          ))}
          {split.participants.length > 4 && (
            <View style={[styles.avatar, styles.avatarOverflow, { marginLeft: -6 }]}>
              <Text style={styles.avatarOverflowText}>+{split.participants.length - 4}</Text>
            </View>
          )}
          <Text style={styles.participantCount}>
            {t('split.participantsAccepted', { accepted, total })}
          </Text>
        </View>

        <Text style={styles.value}>
          {valuePrefix}
          <Text style={styles.valueBold}>{valueDisplay}</Text>
          <Text style={styles.valueUnit}> {valueSuffix}</Text>
        </Text>
      </View>

      {/* Adhesion progress bar */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.min(100, Math.round(progress * 100))}%`,
              backgroundColor: accent,
            },
          ]}
        />
      </View>
    </TouchableOpacity>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
  },
  cardClosed: {
    opacity: 0.55,
  },

  // Badge row
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeBadge: {
    borderWidth: 0.5,
    borderRadius: spacing.radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  typeText: {
    fontSize: 9.5,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 9.5 * 0.14,
    fontWeight: typography.weight.medium,
  },
  expiry: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
  },

  // Name
  name: {
    fontSize: 16,
    fontWeight: typography.weight.bold,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    marginBottom: 6,
  },

  // Bottom row
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.black[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: 9.5,
    fontWeight: typography.weight.bold,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  avatarOverflow: {
    backgroundColor: colors.black[80],
  },
  avatarOverflowText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
  },
  participantCount: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    marginLeft: 10,
  },
  value: {
    fontSize: 15,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  valueBold: {
    fontWeight: typography.weight.bold,
    fontVariant: ['tabular-nums'],
  },
  valueUnit: {
    fontSize: 11,
    fontWeight: typography.weight.regular,
    color: 'rgba(255,255,255,0.4)',
  },

  // Progress bar
  progressTrack: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 1,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1,
  },
})
