import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native'
import { foodFont, foodSpace } from '../../tokens/food'
import { useFoodTheme } from './FoodTheme'

interface FoodInputProps extends Pick<TextInputProps, 'value' | 'onChangeText' | 'placeholder' | 'keyboardType'> {
  label: string
  error?: string
  disabled?: boolean
}

export function FoodInput({ label, error, disabled, ...input }: FoodInputProps) {
  const c = useFoodTheme()
  const [focused, setFocused] = useState(false)

  const lineColor = error ? c.error : focused ? c.accent : disabled ? c.line : c.controlBorder

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: c.inkSubtle }]}>{label}</Text>
      <TextInput
        {...input}
        editable={!disabled}
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        placeholderTextColor={c.inkSubtle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, { color: disabled ? c.inkSubtle : c.ink, borderBottomColor: lineColor }]}
      />
      {error ? <Text style={[styles.error, { color: c.error }]}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: foodSpace.s2 },
  label: { ...foodFont.eyebrow, fontFamily: foodFont.family, textTransform: 'uppercase' },
  input: {
    ...foodFont.body,
    fontFamily: foodFont.family,
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  error: { ...foodFont.caption, fontFamily: foodFont.family },
})
