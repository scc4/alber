import React from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { foodFont, foodRadius, foodSize, foodSpace } from '../../tokens/food'
import { useFoodTheme } from './FoodTheme'

interface FoodChipProps {
  label: string
  selected?: boolean
  disabled?: boolean
  onPress: () => void
}

export function FoodChip({ label, selected = false, disabled = false, onPress }: FoodChipProps) {
  const c = useFoodTheme()

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={[
        styles.base,
        {
          backgroundColor: selected ? c.accent : 'transparent',
          borderColor: selected ? c.accent : disabled ? c.line : c.controlBorder,
        },
      ]}
    >
      <Text style={[styles.label, { color: selected ? c.onAccent : disabled ? c.inkSubtle : c.ink }]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    height: foodSize.chipHeight,
    paddingHorizontal: foodSpace.s4,
    borderRadius: foodRadius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  label: { ...foodFont.label, fontFamily: foodFont.family },
})
