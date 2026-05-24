import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

export type AlertTone = 'warning' | 'info' | 'success' | 'error'

interface AlertCardProps {
  tone?: AlertTone
  text: string
  cta?: string
  onPress?: () => void
}

const toneMap: Record<AlertTone, { color: string; bg: string; border: string }> = {
  warning: {
    color:  '#F59E0B',
    bg:     'rgba(245,158,11,0.07)',
    border: 'rgba(245,158,11,0.22)',
  },
  info: {
    color:  'rgba(255,255,255,0.65)',
    bg:     'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.10)',
  },
  success: {
    color:  '#22C55E',
    bg:     'rgba(34,197,94,0.07)',
    border: 'rgba(34,197,94,0.22)',
  },
  error: {
    color:  '#EF4444',
    bg:     'rgba(239,68,68,0.07)',
    border: 'rgba(239,68,68,0.22)',
  },
}

export function AlertCard({ tone = 'warning', text, cta, onPress }: AlertCardProps) {
  const t = toneMap[tone]
  const Container = onPress ? Pressable : View

  return (
    <Container
      onPress={onPress}
      accessible={!!onPress}
      accessibilityRole={onPress ? 'button' : 'none'}
      accessibilityLabel={text}
      style={({ pressed }: { pressed?: boolean }) => [
        styles.container,
        { backgroundColor: t.bg, borderColor: t.border },
        onPress && (pressed as boolean) && styles.pressed,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: t.color }]} />
      <Text style={[styles.text, { color: t.color }]}>{text}</Text>
      {cta && (
        <Text style={[styles.cta, { color: t.color }]}>{cta}</Text>
      )}
    </Container>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            10,
    borderWidth:    0.5,
    borderRadius:   10,
    paddingVertical:   10,
    paddingHorizontal: 14,
  },
  dot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    flexShrink:   0,
  },
  text: {
    flex:       1,
    fontSize:   typography.size.caption.fontSize,
    lineHeight: typography.size.caption.lineHeight,
  },
  cta: {
    fontSize:      typography.size.micro.fontSize,
    fontWeight:    typography.weight.bold,
    letterSpacing: 0.22,
  },
  pressed: {
    opacity: 0.7,
  },
})
