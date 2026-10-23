import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { foodFont, foodRadius, foodSize, foodSpace } from '../../tokens/food'
import { formatAlbers } from './format'
import { useFoodTheme } from './FoodTheme'

interface OrderLineProps {
  name: string
  note?: string
  quantity: number
  unitPrice: number
  disabled?: boolean
  onChangeQuantity: (quantity: number) => void
}

export function OrderLine({ name, note, quantity, unitPrice, disabled = false, onChangeQuantity }: OrderLineProps) {
  const { t } = useTranslation()
  const c = useFoodTheme()
  const canDecrease = !disabled && quantity > 1

  const Step = ({ label, glyph, enabled, onPress }: { label: string; glyph: string; enabled: boolean; onPress: () => void }) => (
    <Pressable
      onPress={enabled ? onPress : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={[styles.step, { borderColor: enabled ? c.controlBorder : c.line }]}
    >
      <Text style={[styles.glyph, { color: enabled ? c.ink : c.inkSubtle }]}>{glyph}</Text>
    </Pressable>
  )

  return (
    <View style={[styles.row, { borderTopColor: c.line }]}>
      <View style={styles.body}>
        <Text style={[styles.name, { color: c.ink }]}>{name}</Text>
        {note ? <Text style={[styles.note, { color: c.inkMuted }]}>{note}</Text> : null}
      </View>
      <View style={styles.qty}>
        <Step
          label={t('food.orderLine.decrease', { name })}
          glyph="−"
          enabled={canDecrease}
          onPress={() => onChangeQuantity(quantity - 1)}
        />
        <Text style={[styles.count, { color: c.ink }]}>{quantity}</Text>
        <Step
          label={t('food.orderLine.increase', { name })}
          glyph="+"
          enabled={!disabled}
          onPress={() => onChangeQuantity(quantity + 1)}
        />
      </View>
      <Text style={[styles.price, { color: c.ink }]}>{formatAlbers(unitPrice * quantity)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: foodSpace.s4,
    paddingVertical: 15,
    borderTopWidth: 0.5,
  },
  body: { flex: 1, minWidth: 0 },
  name: { ...foodFont.body, fontWeight: '600', fontFamily: foodFont.family },
  note: { ...foodFont.bodySm, fontFamily: foodFont.family },
  qty: { flexDirection: 'row', alignItems: 'center', gap: foodSpace.s2 },
  step: {
    width: foodSize.touch,
    height: foodSize.touch,
    borderRadius: foodRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 20, fontWeight: '500', fontFamily: foodFont.family },
  count: { minWidth: 24, textAlign: 'center', ...foodFont.body, fontWeight: '600', fontFamily: foodFont.family },
  price: { minWidth: 64, textAlign: 'right', ...foodFont.price, fontFamily: foodFont.family, fontVariant: ['tabular-nums'] },
})
