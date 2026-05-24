import React from 'react'
import { StyleSheet, Text, TextStyle } from 'react-native'
import { typography } from '../../tokens/typography'

interface EyebrowProps {
  children: React.ReactNode
  color?: string
  style?: TextStyle
}

export function Eyebrow({
  children,
  color = 'rgba(255,255,255,0.32)',
  style,
}: EyebrowProps) {
  return (
    <Text style={[styles.base, { color }, style]}>
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  base: {
    fontSize:      typography.eyebrow.fontSize,
    fontWeight:    typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: typography.eyebrow.textTransform,
    fontFamily:    typography.fontFamily.primary,
  },
})
