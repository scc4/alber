import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { foodFont, foodSpace } from '../../tokens/food'
import { formatAlbers } from './format'
import { FoodSkeleton } from './FoodSkeleton'
import { useFoodTheme } from './FoodTheme'

export type MenuItemState = 'default' | 'loading' | 'unavailable'

interface MenuItemProps {
  name: string
  description?: string
  price: number
  state?: MenuItemState
  onPress?: () => void
}

export function MenuItem({ name, description, price, state = 'default', onPress }: MenuItemProps) {
  const { t } = useTranslation()
  const c = useFoodTheme()
  const off = state === 'unavailable'

  if (state === 'loading') {
    return (
      <View style={[styles.row, { borderTopColor: c.line }]}>
        <View style={styles.body}>
          <FoodSkeleton width="60%" height={18} />
          <FoodSkeleton width="90%" height={14} />
        </View>
        <FoodSkeleton width={56} height={20} />
      </View>
    )
  }

  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatAlbers(price)}`}
      accessibilityState={{ disabled: off }}
      style={[styles.row, { borderTopColor: c.line }]}
    >
      <View style={styles.body}>
        <Text style={[styles.name, { color: off ? c.inkSubtle : c.ink }]}>{name}</Text>
        {description ? (
          <Text style={[styles.desc, { color: off ? c.inkSubtle : c.inkMuted }]}>{description}</Text>
        ) : null}
        {off ? <Text style={[styles.off, { color: c.error }]}>{t('food.menuItem.unavailable')}</Text> : null}
      </View>
      <Text style={[styles.price, { color: off ? c.inkSubtle : c.ink }]}>{formatAlbers(price)}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: foodSpace.s4,
    paddingVertical: 15,
    borderTopWidth: 0.5,
  },
  body: { flex: 1, gap: foodSpace.s1 },
  name: { ...foodFont.body, fontWeight: '600', fontFamily: foodFont.family },
  desc: { ...foodFont.bodySm, fontFamily: foodFont.family },
  off: { ...foodFont.caption, fontFamily: foodFont.family },
  price: { ...foodFont.price, fontFamily: foodFont.family, fontVariant: ['tabular-nums'] },
})
