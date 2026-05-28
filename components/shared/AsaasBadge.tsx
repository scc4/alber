// Compliance: Playbook BaaS Asaas — exibição obrigatória em todas as telas financeiras
// Abre https://asaas.com via Linking quando clicado

import { Linking, Pressable, StyleSheet, Text } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

interface AsaasBadgeProps {
  variant?: 'dark' | 'light'
  size?: 'default' | 'small'
}

function ShieldIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size + 2} viewBox="0 0 12 14">
      <Path
        d="M6 0L0 2.5V7C0 10.3 2.7 13.3 6 14C9.3 13.3 12 10.3 12 7V2.5L6 0Z"
        fill={color}
      />
    </Svg>
  )
}

export function AsaasBadge({ variant = 'dark', size = 'default' }: AsaasBadgeProps) {
  const { t } = useTranslation()
  const isSmall = size === 'small'

  const bg      = variant === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
  const border  = variant === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'
  const txtClr  = variant === 'dark' ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)'
  const icoClr  = variant === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)'
  const icoSize = isSmall ? 9 : 11

  return (
    <Pressable
      onPress={() => Linking.openURL('https://asaas.com')}
      style={[
        styles.badge,
        isSmall && styles.badgeSmall,
        { backgroundColor: bg, borderColor: border },
      ]}
      accessibilityRole="link"
      accessibilityLabel={t('shared.asaasBadge')}
      hitSlop={8}
    >
      <ShieldIcon color={icoClr} size={icoSize} />
      <Text style={[styles.label, isSmall && styles.labelSmall, { color: txtClr }]}>
        {t('shared.asaasBadge')}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: spacing.radius.full,
    borderWidth: 0.5,
  },
  badgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 0.1,
  },
  labelSmall: {
    fontSize: 10,
  },
})
