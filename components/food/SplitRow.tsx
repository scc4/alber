import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { foodFont, foodSpace } from '../../tokens/food'
import { formatAlbers } from './format'
import { FoodBadge } from './FoodBadge'
import { useFoodTheme } from './FoodTheme'

export type SplitStatus = 'paid' | 'pending'

interface SplitRowProps {
  name: string
  status: SplitStatus
  amount: number
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function SplitRow({ name, status, amount }: SplitRowProps) {
  const { t } = useTranslation()
  const c = useFoodTheme()

  return (
    <View style={[styles.row, { borderTopColor: c.line }]}>
      <View style={[styles.avatar, { backgroundColor: c.surfaceRaised }]}>
        <Text style={[styles.initials, { color: c.ink }]}>{initials(name)}</Text>
      </View>
      <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>{name}</Text>
      <FoodBadge
        label={t(status === 'paid' ? 'food.split.paid' : 'food.split.pending')}
        tone={status === 'paid' ? 'success' : 'warning'}
      />
      <Text style={[styles.amount, { color: c.ink }]}>{formatAlbers(amount)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: foodSpace.s3,
    paddingVertical: 15,
    borderTopWidth: 0.5,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  initials: { ...foodFont.label, fontFamily: foodFont.family },
  name: { flex: 1, ...foodFont.body, fontWeight: '600', fontFamily: foodFont.family },
  amount: { ...foodFont.price, fontFamily: foodFont.family, fontVariant: ['tabular-nums'] },
})
