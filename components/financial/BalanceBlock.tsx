// Design: /design/flows1.jsx — bloco de saldo na Home
// Spec: /specs/06_modules/home.md seção 3.2
// Estados: loading (skeleton), success, hidden (••••), empty (zero), error

import React, { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Eyebrow } from '../shared/Eyebrow'
import { formatAlbers } from '../../utils/format'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

export type BalanceStatus = 'idle' | 'loading' | 'success' | 'error'

interface BalanceBlockProps {
  balance: number
  status: BalanceStatus
  hidden: boolean
  onToggle: () => void
  onCarregarMais: () => void
  onRetry: () => void
}

export function BalanceBlock({
  balance,
  status,
  hidden,
  onToggle,
  onCarregarMais,
  onRetry,
}: BalanceBlockProps) {
  const { t } = useTranslation()
  const pulse = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    if (status !== 'loading' && status !== 'idle') {
      pulse.setValue(1)
      return
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [status, pulse])

  if (status === 'loading' || status === 'idle') {
    return (
      <View style={styles.root}>
        <Eyebrow>{t('home.balance.label')}</Eyebrow>
        <Animated.View style={[styles.skeletonLarge, { opacity: pulse }]} />
        <Animated.View style={[styles.skeletonSmall, { opacity: pulse }]} />
      </View>
    )
  }

  if (status === 'error') {
    return (
      <View style={styles.root}>
        <Eyebrow>{t('home.balance.label')}</Eyebrow>
        <Text style={styles.errorText}>{t('home.balance.error')}</Text>
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.retryText}>{t('home.balance.retry')}</Text>
        </Pressable>
      </View>
    )
  }

  const isEmpty = balance === 0
  const displayValue = hidden ? '••••' : formatAlbers(balance)

  return (
    <View style={styles.root}>
      <Eyebrow>{t('home.balance.label')}</Eyebrow>

      <Pressable
        onPress={onToggle}
        style={styles.valueRow}
        accessibilityRole="button"
        accessibilityLabel={hidden ? t('home.balance.show') : t('home.balance.hide')}
      >
        <Text style={[styles.value, isEmpty && !hidden && styles.valueZero]}>
          {displayValue}
        </Text>
        <Text style={styles.unit}>{t('home.balance.unit')}</Text>
      </Pressable>

      <Pressable onPress={onCarregarMais} hitSlop={8}>
        <Text style={[styles.carregarMais, isEmpty && styles.carregarMaisHighlight]}>
          {t('home.balance.carregarMais')}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: spacing.lg,
    paddingTop: 30,
  },
  skeletonLarge: {
    height: 56,
    width: 160,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.sm,
    marginTop: spacing.sm,
  },
  skeletonSmall: {
    height: 14,
    width: 100,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: spacing.radius.sm,
    marginTop: 10,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
    marginTop: spacing.sm,
  },
  value: {
    fontSize: 54,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -2.16,
    lineHeight: 60,
    fontFamily: typography.fontFamily.primary,
    fontVariant: ['tabular-nums'],
  },
  valueZero: {
    color: colors.gray[400],
  },
  unit: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '400',
    fontFamily: typography.fontFamily.primary,
  },
  carregarMais: {
    marginTop: 8,
    fontSize: 13,
    color: 'rgba(255,255,255,0.42)',
    fontFamily: typography.fontFamily.primary,
  },
  carregarMaisHighlight: {
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
  },
  errorText: {
    fontSize: typography.size.body.fontSize,
    color: colors.state.error,
    marginTop: spacing.sm,
    fontFamily: typography.fontFamily.primary,
  },
  retryText: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.45)',
    marginTop: spacing.xs,
    textDecorationLine: 'underline',
    fontFamily: typography.fontFamily.primary,
  },
})
