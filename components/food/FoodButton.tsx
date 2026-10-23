import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'
import { foodFont, foodRadius, foodSize, foodSpace } from '../../tokens/food'
import { useFoodTheme } from './FoodTheme'

export type FoodButtonVariant = 'primary' | 'secondary' | 'text'
export type FoodButtonState = 'default' | 'loading' | 'disabled'

interface FoodButtonProps {
  label: string
  onPress: () => void
  variant?: FoodButtonVariant
  state?: FoodButtonState
  accessibilityLabel?: string
}

export function FoodButton({
  label,
  onPress,
  variant = 'primary',
  state = 'default',
  accessibilityLabel,
}: FoodButtonProps) {
  const c = useFoodTheme()
  const inactive = state !== 'default'

  const bg = variant === 'primary' ? c.accent : 'transparent'
  const fg = variant === 'primary' ? c.onAccent : variant === 'secondary' ? c.ink : c.inkMuted
  const border = variant === 'secondary' ? c.controlBorder : 'transparent'

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: state === 'loading' }}
      style={[
        styles.base,
        { backgroundColor: bg, borderColor: border },
        variant === 'text' && styles.textVariant,
        state === 'disabled' && { backgroundColor: c.surface, borderColor: c.line },
      ]}
    >
      {state === 'loading' ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text style={[styles.label, { color: state === 'disabled' ? c.inkSubtle : fg }]}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    height: foodSize.buttonHeight,
    borderRadius: foodRadius.lg,
    borderWidth: 1,
    paddingHorizontal: foodSpace.s5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textVariant: { paddingHorizontal: foodSpace.s3 },
  label: {
    fontFamily: foodFont.family,
    fontSize: 14,
    fontWeight: '700',
  },
})
