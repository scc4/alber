// Design: /design/flows1.jsx (home header) + /design/primitives.jsx (TopBar)
// Spec: /specs/06_modules/home.md seção 3.1
// Variantes: home (logo + saudação + sino), title (voltar + título), search (título + lupa)

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AlberLogo } from './AlberLogo'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface HomeHeaderProps {
  variant: 'home'
  userName: string
  accentColor?: string
  hasNotification?: boolean
  onLogoPress?: () => void
  onBell?: () => void
  onAvatarPress?: () => void
}

interface TitleHeaderProps {
  variant: 'title'
  title: string
  contextLabel?: string
  onBack?: () => void
  right?: React.ReactNode
  scrolled?: boolean
}

interface SearchHeaderProps {
  variant: 'search'
  title: string
  onBack?: () => void
  onSearch?: () => void
}

export type HeaderProps = HomeHeaderProps | TitleHeaderProps | SearchHeaderProps

// ─── Componente ───────────────────────────────────────────────────────────────

export function Header(props: HeaderProps) {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  if (props.variant === 'home') {
    const hour = new Date().getHours()
    const greeting =
      hour >= 5 && hour < 12
        ? t('home.greeting.morning')
        : hour < 18
        ? t('home.greeting.afternoon')
        : t('home.greeting.evening')
    const accent = props.accentColor ?? colors.white[100]

    return (
      <View style={[styles.homeRoot, { paddingTop: insets.top + 10 }]}>
        {props.onLogoPress != null ? (
          <Pressable onPress={props.onLogoPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="Home">
            <AlberLogo size={32} />
          </Pressable>
        ) : (
          <AlberLogo size={32} />
        )}
        <Pressable
          style={styles.greetingBlock}
          onPress={props.onAvatarPress}
          accessibilityRole="button"
          accessibilityLabel={props.userName}
          hitSlop={8}
        >
          <Text style={styles.greetingLine}>{greeting}</Text>
          <Text style={styles.userName}>{props.userName}</Text>
        </Pressable>
        <Pressable
          onPress={props.onBell}
          style={styles.bellButton}
          accessibilityRole="button"
          accessibilityLabel={t('home.notifications')}
          hitSlop={8}
        >
          <BellIcon />
          {props.hasNotification && (
            <View style={[styles.bellDot, { backgroundColor: accent }]} />
          )}
        </Pressable>

      </View>
    )
  }

  if (props.variant === 'title') {
    return (
      <View
        style={[
          styles.titleRoot,
          { paddingTop: insets.top },
          props.scrolled && styles.titleScrolled,
        ]}
      >
        {props.onBack != null && (
          <Pressable
            onPress={props.onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            hitSlop={8}
          >
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
        )}
        <View style={styles.titleBlock}>
          {props.contextLabel != null && (
            <Text style={styles.contextLabel}>{props.contextLabel}</Text>
          )}
          <Text style={styles.titleText} numberOfLines={1}>
            {props.title}
          </Text>
        </View>
        {props.right ?? null}
      </View>
    )
  }

  // search variant
  return (
    <View style={[styles.titleRoot, { paddingTop: insets.top }]}>
      {props.onBack != null && (
        <Pressable
          onPress={props.onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={8}
        >
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
      )}
      <View style={styles.titleBlock}>
        <Text style={styles.titleText} numberOfLines={1}>
          {props.title}
        </Text>
      </View>
      <Pressable
        onPress={props.onSearch}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Buscar"
        hitSlop={8}
      >
        <SearchIcon />
      </Pressable>
    </View>
  )
}

// ─── Ícones (puro View, sem react-native-svg) ─────────────────────────────────

const IC = 'rgba(255,255,255,0.7)'
const IW = 1.4

function BellIcon() {
  return (
    <View style={ic.root}>
      <View style={ic.dome} />
      <View style={ic.base} />
      <View style={ic.clapper} />
    </View>
  )
}

function SearchIcon() {
  return (
    <View style={ic.root}>
      <View style={ic.searchCircle} />
      <View style={ic.searchHandle} />
    </View>
  )
}

const ic = StyleSheet.create({
  root: { width: 16, height: 16 },

  // Bell dome: bordas arredondadas no topo, sem borda inferior
  dome: {
    position: 'absolute',
    top: 0,
    left: 1,
    width: 14,
    height: 11,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderWidth: IW,
    borderColor: IC,
    borderBottomWidth: 0,
  },
  // Barra horizontal da base do sino
  base: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    height: IW,
    backgroundColor: IC,
    borderRadius: 1,
  },
  // Badalo: arco pequeno na base central
  clapper: {
    position: 'absolute',
    bottom: 1,
    left: 5,
    width: 6,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderWidth: IW,
    borderColor: IC,
    borderTopWidth: 0,
  },

  // Lupa: círculo + cabo diagonal
  searchCircle: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: IW,
    borderColor: IC,
  },
  searchHandle: {
    position: 'absolute',
    bottom: 1,
    right: 0,
    width: 6,
    height: IW,
    backgroundColor: IC,
    borderRadius: 1,
    transform: [{ rotate: '-45deg' }],
  },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Home
  homeRoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.lg,
  },
  logo: {
    flexShrink: 0,
  },
  greetingBlock: {
    flex: 1,
  },
  greetingLine: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.42)',
    fontFamily: typography.fontFamily.primary,
  },
  userName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.34,
    marginTop: 1,
    fontFamily: typography.fontFamily.primary,
  },
  bellButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },


  // Title / Search
  titleRoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.lg,
    minHeight: spacing.headerHeight,
  },
  titleScrolled: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backButton: {
    width: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -8,
  },
  backArrow: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 30,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  contextLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: 1,
  },
  titleText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.255,
    fontFamily: typography.fontFamily.primary,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
})
