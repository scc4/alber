// Design: /design/primitives.jsx — BottomNav
// Spec: /specs/06_modules/home.md seção 3.5
// 4 itens: Perfil, Achar, Lounge, Atividade
// Item ativo: opacity 1 | inativo: opacity 0.32

import React, { useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

export type BottomNavItem = 'perfil' | 'achar' | 'lounge' | 'atividade'

interface BottomNavProps {
  active: BottomNavItem | string  // 'home' ou rota não listada = nenhum item ativo
  onNavigate: (item: BottomNavItem) => void
}

const ITEMS: Array<{ id: BottomNavItem; label: string }> = [
  { id: 'perfil',    label: 'Perfil' },
  { id: 'achar',     label: 'Achar' },
  { id: 'lounge',    label: 'Lounge' },
  { id: 'atividade', label: 'Atividade' },
]

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[
        styles.root,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      {ITEMS.map(item => (
        <NavTab
          key={item.id}
          id={item.id}
          label={item.label}
          isActive={active === item.id}
          onPress={() => onNavigate(item.id)}
        />
      ))}
    </View>
  )
}

// ─── Tab com animação de opacidade ───────────────────────────────────────────

interface NavTabProps {
  id: BottomNavItem
  label: string
  isActive: boolean
  onPress: () => void
}

function NavTab({ id, label, isActive, onPress }: NavTabProps) {
  const opacity = useRef(new Animated.Value(isActive ? 1 : 0.32)).current

  React.useEffect(() => {
    Animated.timing(opacity, {
      toValue: isActive ? 1 : 0.32,
      duration: 180,
      useNativeDriver: true,
    }).start()
  }, [isActive, opacity])

  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive }}
    >
      <Animated.View style={[styles.tabInner, { opacity }]}>
        <NavIcon id={id} />
        <Text style={styles.label}>{label}</Text>
      </Animated.View>
    </Pressable>
  )
}

// ─── Ícones (puro View, sem react-native-svg) ─────────────────────────────────

function NavIcon({ id }: { id: BottomNavItem }) {
  switch (id) {
    case 'perfil':    return <PerfilIcon />
    case 'achar':     return <AcharIcon />
    case 'lounge':    return <LoungeIcon />
    case 'atividade': return <AtividadeIcon />
  }
}

const C  = colors.white[100]
const IW = 1.4

function PerfilIcon() {
  return (
    <View style={ic.root}>
      {/* Cabeça */}
      <View style={ic.perfilHead} />
      {/* Ombros (arco superior) */}
      <View style={ic.perfilShoulders} />
    </View>
  )
}

function AcharIcon() {
  return (
    <View style={ic.root}>
      <View style={ic.acharCircle} />
      <View style={ic.acharHandle} />
    </View>
  )
}

function LoungeIcon() {
  return (
    <View style={ic.root}>
      <View style={[ic.loungeSquare, { top: 2,  left: 2  }]} />
      <View style={[ic.loungeSquare, { top: 2,  right: 2 }]} />
      <View style={[ic.loungeSquare, { bottom: 2, left: 2  }]} />
      <View style={[ic.loungeSquare, { bottom: 2, right: 2 }]} />
    </View>
  )
}

function AtividadeIcon() {
  return (
    <View style={ic.root}>
      <View style={[ic.line, { top: 4  }]} />
      <View style={[ic.line, { top: 9  }]} />
      <View style={[ic.lineShort, { top: 14 }]} />
    </View>
  )
}

// ─── Icon styles ─────────────────────────────────────────────────────────────

const ic = StyleSheet.create({
  root: { width: 20, height: 20 },

  perfilHead: {
    position: 'absolute',
    top: 1,
    left: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: IW,
    borderColor: C,
  },
  perfilShoulders: {
    position: 'absolute',
    bottom: 1,
    left: 2,
    width: 16,
    height: 9,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: IW,
    borderColor: C,
    borderBottomWidth: 0,
  },

  acharCircle: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: IW,
    borderColor: C,
  },
  acharHandle: {
    position: 'absolute',
    bottom: 1,
    right: 0,
    width: 7,
    height: IW,
    backgroundColor: C,
    borderRadius: 1,
    transform: [{ rotate: '-45deg' }],
  },

  loungeSquare: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 1.5,
    borderWidth: IW,
    borderColor: C,
  },

  line: {
    position: 'absolute',
    left: 3,
    width: 14,
    height: IW,
    backgroundColor: C,
    borderRadius: 1,
  },
  lineShort: {
    position: 'absolute',
    left: 3,
    width: 9,
    height: IW,
    backgroundColor: C,
    borderRadius: 1,
  },
})

// ─── Component styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.96)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 10,
  },
  tab: {
    flex: 1,
  },
  tabInner: {
    alignItems: 'center',
    gap: 5,
  },
  label: {
    fontSize: typography.navLabel.fontSize,
    fontWeight: typography.navLabel.fontWeight,
    letterSpacing: typography.navLabel.letterSpacing,
    textTransform: typography.navLabel.textTransform,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
})
