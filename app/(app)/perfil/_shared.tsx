// Componentes e estilos compartilhados entre o perfil pessoal (index.tsx) e o
// perfil da empresa (_company-perfil.tsx) — extraídos daqui pra manter os
// dois visualmente idênticos sem duplicar StyleSheet.

import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, spaceSkins } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

// ── ActionRow ─────────────────────────────────────────────────────────────────

interface ActionRowProps {
  label: string
  sublabel?: string
  accentSublabel?: boolean
  accentColor?: string
  onPress: () => void
}

export function ActionRow({ label, sublabel, accentSublabel, accentColor, onPress }: ActionRowProps) {
  const sublabelColor = accentSublabel && accentColor
    ? accentColor
    : 'rgba(255,255,255,0.4)'

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.65}>
      <View style={styles.rowDot} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? (
          <Text style={[styles.rowSublabel, { color: sublabelColor }]}>{sublabel}</Text>
        ) : null}
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </TouchableOpacity>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

interface SectionProps { title: string; children: React.ReactNode }

export function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

export function UserAvatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarInitial}>{name[0].toUpperCase()}</Text>
    </View>
  )
}

// ── Verified badge ────────────────────────────────────────────────────────────

export function VerifiedBadge() {
  return (
    <View style={styles.verifiedBadge}>
      <Text style={styles.verifiedCheck}>✓</Text>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const surf = spaceSkins.surf

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.bottomNavHeight + spacing.lg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.size.h1,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    letterSpacing: -0.5,
  },
  // Hero
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: surf.bgDark,
    borderWidth: 1,
    borderColor: `${surf.accent}55`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: typography.weight.bold,
    color: surf.accent,
  },
  heroMeta: {
    flex: 1,
  },
  heroName: {
    ...typography.size.h2,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
  },
  heroHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  heroHandle: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.5)',
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: `${surf.accent}1A`,
    borderWidth: 0.5,
    borderColor: `${surf.accent}66`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedCheck: {
    fontSize: 8,
    color: surf.accent,
    fontWeight: typography.weight.bold,
  },
  heroSince: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.32)',
    marginTop: 3,
  },
  // Sections
  section: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.sm,
  },
  sectionBody: {},
  // ActionRow
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  rowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    ...typography.size.label,
    color: colors.white[100],
  },
  rowSublabel: {
    ...typography.size.caption,
    marginTop: 2,
  },
  rowChevron: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.2)',
  },
  pixSuccessWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: spacing.radius.md,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(34,197,94,0.25)',
  },
  pixSuccessText: {
    fontSize: 12,
    color: colors.state.success,
    fontFamily: typography.fontFamily.primary,
  },
  suporteIntro: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 17,
    marginBottom: spacing.xs,
  },
  // Session / logout
  sessionSection: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  logoutBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 11,
    borderWidth: 0.5,
    borderColor: `${colors.state.error}4D`,
    backgroundColor: 'transparent',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  logoutText: {
    ...typography.size.caption,
    fontWeight: typography.weight.bold,
    color: colors.state.error,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
})
