// Extraído de app/(app)/index.tsx — banner contextual (KYC, avaliação, etc.)
// usado no topo da Home pessoal e da Home da empresa, mesmo visual/estados.

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

export type BannerData = {
  tone: 'warning' | 'error' | 'info'
  text: string
  cta: string
  dismissible: boolean
  target: string
}

interface HomeBannerProps {
  banner: BannerData
  onPress: () => void
  onDismiss?: () => void
}

export function HomeBanner({ banner, onPress, onDismiss }: HomeBannerProps) {
  const tones = {
    warning: { color: colors.warning[500],  bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.22)' },
    error:   { color: colors.state.error,   bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.22)' },
    info:    { color: 'rgba(255,255,255,0.65)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)' },
  }
  const t = tones[banner.tone]

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }]}
        accessibilityRole="button"
      >
        <View style={[styles.bannerDot, { backgroundColor: t.color }]} />
        <Text style={[styles.bannerText, { color: t.color }]}>{banner.text}</Text>
        <Text style={[styles.bannerCta, { color: t.color }]}>{banner.cta}</Text>
        {onDismiss != null && (
          <Pressable onPress={onDismiss} hitSlop={8} style={styles.bannerClose}>
            <Text style={[styles.bannerCloseText, { color: t.color }]}>✕</Text>
          </Pressable>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: 14,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    paddingHorizontal: 14,
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
  },
  bannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.fontFamily.primary,
  },
  bannerCta: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.22,
    fontFamily: typography.fontFamily.primary,
  },
  bannerClose: {
    paddingLeft: 6,
  },
  bannerCloseText: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
  },
})
