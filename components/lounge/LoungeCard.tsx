// Design: /design/flows-rest.jsx — SpacesScreen (card list)
// Spec: /specs/06_modules/alber_lounge.md § 2 e § 5
// Variantes: owner (dono) | member (membro) | public | private
// Layout: hero escuro com dot de acento, badge de papel, nome, nº membros

import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoungeRole = 'owner' | 'manager' | 'member' | null

export interface LoungeSummary {
  id:          string
  name:        string
  accent:      string
  bgDark:      string
  imageUri:    string | null
  memberCount: number
  role:        LoungeRole
  visibility:  'public' | 'private'
  isPrimary?:  boolean
}

interface Props {
  lounge:   LoungeSummary
  onPress:  () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LoungeCard({ lounge, onPress }: Props) {
  const { t } = useTranslation()

  const isOwner   = lounge.role === 'owner'
  const isManager = lounge.role === 'manager'
  const hasBadge  = lounge.role !== null
  const isPrimary = lounge.isPrimary ?? false

  const roleLabel = isOwner
    ? t('lounge.roleOwner')
    : isManager
    ? t('lounge.roleManager')
    : t('lounge.roleMember')

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.card,
        { backgroundColor: lounge.bgDark, borderColor: isOwner ? `${lounge.accent}55` : 'rgba(255,255,255,0.08)' },
        isOwner && styles.cardOwner,
      ]}
      accessibilityRole="button"
      accessibilityLabel={lounge.name}
    >
      {/* Cover image */}
      {lounge.imageUri ? (
        <Image
          source={{ uri: lounge.imageUri }}
          style={styles.cover}
          resizeMode="cover"
        />
      ) : null}

      {/* Scrim so text stays legible over the image */}
      <View style={styles.scrim} pointerEvents="none" />

      {/* Accent glow — only for owner */}
      {isOwner && (
        <View
          style={[
            styles.glowOverlay,
            { backgroundColor: `${lounge.accent}14` },
          ]}
          pointerEvents="none"
        />
      )}

      {/* Content */}
      <View style={styles.inner} pointerEvents="none">
        {/* Top row: dot + role badge + principal badge */}
        <View style={styles.topRow}>
          <View style={[styles.accentDot, { backgroundColor: lounge.accent }]} />
          {hasBadge && (
            <View
              style={[
                styles.badge,
                isOwner
                  ? { backgroundColor: `${lounge.accent}22`, borderColor: `${lounge.accent}55` }
                  : styles.badgeDefault,
              ]}
            >
              <Text style={[styles.badgeText, { color: isOwner ? lounge.accent : 'rgba(255,255,255,0.7)' }]}>
                {roleLabel}
              </Text>
            </View>
          )}
          {!hasBadge && lounge.visibility === 'private' && (
            <View style={styles.badgeDefault}>
              <Text style={styles.badgeText}>{t('lounge.visPrivate')}</Text>
            </View>
          )}
          {isPrimary && (
            <View style={[styles.badge, { backgroundColor: `${lounge.accent}22`, borderColor: `${lounge.accent}55` }]}>
              <Text style={[styles.badgeText, { color: lounge.accent }]}>
                {t('lounge.badgePrimary')}
              </Text>
            </View>
          )}
        </View>

        {/* Bottom: name + members */}
        <View>
          <Text style={[styles.name, isOwner && styles.nameOwner]}>
            {lounge.name}
          </Text>
          <Text style={styles.members}>
            {t('lounge.members', { n: lounge.memberCount })}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    height: 116,
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
  },
  cardOwner: {
    height: 136,
  },
  cover: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  scrim: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  glowOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  inner: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 0.5,
  },
  badgeDefault: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0,
  },
  badgeText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 9 * 0.14,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -20 * 0.02,
  },
  nameOwner: {
    fontSize: 22,
  },
  members: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
  },
})
