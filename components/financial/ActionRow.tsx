// Extraído de app/(app)/index.tsx — usado pela Home pessoal e pela Home da
// empresa para garantir o mesmo visual/estados (default/pressed/disabled).

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'

interface ActionRowProps {
  icon: React.ReactNode
  label: string
  sublabel?: string
  onPress: () => void
  disabled?: boolean
}

export function ActionRow({ icon, label, sublabel, onPress, disabled }: ActionRowProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.actionRow, disabled && styles.actionRowDisabled, pressed && styles.actionRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <View style={styles.actionLabel}>
        <Text style={styles.actionText}>{label}</Text>
        {sublabel != null && <Text style={styles.actionSublabel}>{sublabel}</Text>}
      </View>
      <Text style={styles.actionChevron}>›</Text>
    </Pressable>
  )
}

// ─── Ícones (puro View) ─────────────────────────────────────────────────────

const AI = 'rgba(255,255,255,0.8)'
const AW = 1.5

export function ReceberIcon() {
  // Seta para baixo: linha vertical + V-chevron
  return (
    <View style={aiv.root}>
      <View style={[aiv.line, { top: 2, left: 9, height: 10 }]} />
      <View style={[aiv.arm, { bottom: 2, left: 4,  transform: [{ rotate: '40deg'  }] }]} />
      <View style={[aiv.arm, { bottom: 2, right: 4, transform: [{ rotate: '-40deg' }] }]} />
    </View>
  )
}

export function CarregarIcon() {
  // Seta para cima: ^-chevron + linha vertical
  return (
    <View style={aiv.root}>
      <View style={[aiv.arm, { top: 2, left: 4,  transform: [{ rotate: '-40deg' }] }]} />
      <View style={[aiv.arm, { top: 2, right: 4, transform: [{ rotate: '40deg'  }] }]} />
      <View style={[aiv.line, { bottom: 2, left: 9, height: 10 }]} />
    </View>
  )
}

export function TransferirIcon() {
  // Seta para a direita: linha horizontal + >-chevron
  return (
    <View style={aiv.root}>
      <View style={[aiv.hline, { top: 9, left: 2, width: 11 }]} />
      <View style={[aiv.arm, { top: 4,  right: 2, transform: [{ rotate: '40deg'  }] }]} />
      <View style={[aiv.arm, { bottom: 4, right: 2, transform: [{ rotate: '-40deg' }] }]} />
    </View>
  )
}

export function SplitIcon() {
  // Barra vertical esquerda + duas setas direita (cima e baixo)
  return (
    <View style={aiv.root}>
      <View style={[aiv.line, { top: 2, left: 2, height: 16 }]} />
      <View style={[aiv.hline, { top: 4, left: 4, width: 8 }]} />
      <View style={[aiv.hline, { bottom: 4, left: 4, width: 8 }]} />
      <View style={[aiv.arm, { top: 2,    right: 2, transform: [{ rotate: '40deg'  }] }]} />
      <View style={[aiv.arm, { bottom: 2, right: 2, transform: [{ rotate: '-40deg' }] }]} />
    </View>
  )
}

const aiv = StyleSheet.create({
  root:  { width: 20, height: 20 },
  line:  { position: 'absolute', width: AW, backgroundColor: AI, borderRadius: 1 },
  hline: { position: 'absolute', height: AW, backgroundColor: AI, borderRadius: 1 },
  arm:   { position: 'absolute', width: 7, height: AW, backgroundColor: AI, borderRadius: 1 },
})

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  actionRowDisabled: {
    opacity: 0.4,
  },
  actionRowPressed: {
    opacity: 0.55,
  },
  actionIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    flex: 1,
  },
  actionText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '400',
    fontFamily: typography.fontFamily.primary,
  },
  actionSublabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
    fontFamily: typography.fontFamily.primary,
  },
  actionChevron: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.2)',
    fontFamily: typography.fontFamily.primary,
  },
})
