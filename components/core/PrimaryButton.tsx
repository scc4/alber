import React, { useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

export type ButtonVariant = 'primary' | 'ghost' | 'destructive' | 'confirm'
export type ButtonState = 'default' | 'loading' | 'disabled' | 'success'

interface PrimaryButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  state?: ButtonState
  accessibilityLabel?: string
}

const variantStyles: Record<ButtonVariant, { bg: string; fg: string; borderColor?: string }> = {
  primary:     { bg: colors.white[100], fg: colors.black[100] },
  confirm:     { bg: colors.white[100], fg: colors.black[100] },
  destructive: { bg: colors.black[80],  fg: colors.state.error },
  ghost: {
    bg:          'rgba(255,255,255,0.06)',
    fg:          colors.white[100],
    borderColor: 'rgba(255,255,255,0.12)',
  },
}

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  state = 'default',
  accessibilityLabel,
}: PrimaryButtonProps) {
  const isDisabled = state === 'disabled' || state === 'loading'
  const scaleAnim = useRef(new Animated.Value(1)).current
  const successScale = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (state === 'success') {
      Animated.spring(successScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 200,
        friction: 10,
      }).start()
    } else {
      successScale.setValue(0)
    }
  }, [state, successScale])

  const handlePressIn = () => {
    Animated.timing(scaleAnim, {
      toValue: 0.98,
      duration: 80,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start()
  }

  const v = variantStyles[variant]
  const spinnerColor = variant === 'primary' || variant === 'confirm'
    ? colors.black[100]
    : colors.white[100]

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={isDisabled ? undefined : onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: isDisabled, busy: state === 'loading' }}
        style={[
          styles.base,
          { backgroundColor: v.bg },
          v.borderColor ? { borderWidth: 0.5, borderColor: v.borderColor } : null,
          isDisabled && styles.disabled,
        ]}
      >
        {state === 'loading' && (
          <ActivityIndicator size="small" color={spinnerColor} />
        )}

        {state === 'success' && (
          <Animated.View style={{ transform: [{ scale: successScale }] }}>
            <Text style={[styles.label, { color: v.fg }]}>✓</Text>
          </Animated.View>
        )}

        {state !== 'loading' && state !== 'success' && (
          <Text style={[styles.label, { color: v.fg }]}>{label}</Text>
        )}
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  base: {
    height:         spacing.buttonHeight,
    width:          '100%',
    borderRadius:   spacing.radius.md,
    alignItems:     'center',
    justifyContent: 'center',
    flexDirection:  'row',
    gap:            8,
  },
  label: {
    fontSize:      typography.button.fontSize,
    fontWeight:    typography.button.fontWeight,
    letterSpacing: typography.button.letterSpacing,
    textTransform: typography.button.textTransform,
    fontFamily:    typography.fontFamily.primary,
  },
  disabled: {
    opacity: 0.3,
  },
})
