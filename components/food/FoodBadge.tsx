import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { foodFont, foodRadius, foodSize, foodSpace } from '../../tokens/food'
import { useFoodTheme } from './FoodTheme'

export type FoodBadgeTone = 'neutral' | 'success' | 'warning' | 'error'

interface FoodBadgeProps {
  label: string
  tone?: FoodBadgeTone
}

/** Status sempre com palavra; só o ponto leva cor de estado. */
export function FoodBadge({ label, tone = 'neutral' }: FoodBadgeProps) {
  const c = useFoodTheme()
  const dot = tone === 'neutral' ? c.inkSubtle : c[tone]

  return (
    <View style={[styles.base, { backgroundColor: c.surfaceRaised }]} accessible accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[styles.label, { color: c.ink }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    height: foodSize.badgeHeight,
    paddingHorizontal: foodSpace.s2,
    borderRadius: foodRadius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: foodSpace.s2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { ...foodFont.caption, fontWeight: '600', fontFamily: foodFont.family },
})
