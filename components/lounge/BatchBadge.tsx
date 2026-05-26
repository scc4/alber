// Design: /design/flows-rest.jsx — EventCard badges
// Spec: /specs/06_modules/alber_lounge.md § 9 "Comprar ingresso"
// Estados: active | last-tickets | sold-out

import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { typography } from '../../tokens/typography'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BatchBadgeStatus = 'active' | 'last-tickets' | 'sold-out'

interface Props {
  status: BatchBadgeStatus
  accent: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BatchBadge({ status, accent }: Props) {
  const { t } = useTranslation()

  if (status === 'active') {
    return (
      <View style={[styles.pill, { borderColor: `${accent}55`, backgroundColor: `${accent}18` }]}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={[styles.label, { color: accent }]}>{t('lounge.batchActive')}</Text>
      </View>
    )
  }

  if (status === 'last-tickets') {
    return (
      <View style={[styles.pill, { borderColor: `${accent}55`, backgroundColor: `${accent}18` }]}>
        <Text style={[styles.label, { color: accent }]}>{t('lounge.batchLastTickets')}</Text>
      </View>
    )
  }

  // sold-out
  return (
    <View style={styles.pillSoldOut}>
      <Text style={styles.labelSoldOut}>{t('lounge.batchSoldOut')}</Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 0.5,
  },
  pillSoldOut: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  label: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 9 * 0.08,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  labelSoldOut: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 9 * 0.08,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
  },
})
