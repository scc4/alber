// Design: /design/flows-split.jsx — SplitListScreen
// Spec: /specs/06_modules/split.md
// Lista de splits ativos e encerrados. 5 estados: loading, error, empty, success, disabled.

import { useEffect, useMemo } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useSplitStore } from '../../../store/split.store'
import { useAuthStore } from '../../../store/auth.store'
import { SplitCard } from '../../../components/split/SplitCard'
import { Header } from '../../../components/core/Header'
import { Eyebrow } from '../../../components/shared/Eyebrow'
import { colors } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SplitIndexScreen() {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  const token        = useAuthStore(s => s.token)
  const splits       = useSplitStore(s => s.splits)
  const loading      = useSplitStore(s => s.loading)
  const error        = useSplitStore(s => s.error)
  const setActiveId  = useSplitStore(s => s.setActiveSplitId)
  const fetchMySplits = useSplitStore(s => s.fetchMySplits)

  const activeSplits = useMemo(() => splits.filter(sp => sp.status === 'active'), [splits])
  const closedSplits = useMemo(() => splits.filter(sp => sp.status !== 'active'), [splits])

  useEffect(() => {
    if (token) fetchMySplits(token)
  }, [token])

  const noSplits = activeSplits.length === 0 && closedSplits.length === 0

  function openSplit(id: string) {
    setActiveId(id)
    router.push(`/(app)/split/${id}`)
  }

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={t('split.title')}
        right={
          <TouchableOpacity
            onPress={() => router.push('/(app)/split/criar')}
            style={styles.createBtn}
            accessibilityRole="button"
          >
            <Text style={styles.createBtnText}>{t('split.createCta')}</Text>
          </TouchableOpacity>
        }
      />

      {/* ── Loading ── */}
      {loading && (
        <View style={styles.feedPad}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      )}

      {/* ── Error ── */}
      {!loading && error !== null && (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={() => { if (token) fetchMySplits(token) }}
            style={styles.emptyCreateBtn}
          >
            <Text style={styles.emptyCreateText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Empty ── */}
      {!loading && error === null && noSplits && (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>{t('split.empty')}</Text>
          <Text style={styles.emptyHint}>{t('split.emptyHint')}</Text>
          <TouchableOpacity
            onPress={() => router.push('/(app)/split/criar')}
            style={styles.emptyCreateBtn}
          >
            <Text style={styles.emptyCreateText}>{t('split.emptyCreateCta')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Success ── */}
      {!loading && error === null && !noSplits && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(96, insets.bottom + spacing.bottomNavHeight + 12) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Ativos */}
          {activeSplits.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Eyebrow>
                  {t('split.sectionActive')} · {activeSplits.length}
                </Eyebrow>
              </View>
              <View style={styles.cardList}>
                {activeSplits.map(sp => (
                  <SplitCard
                    key={sp.id}
                    split={sp}
                    onPress={() => openSplit(sp.id)}
                  />
                ))}
              </View>
            </>
          )}

          {/* Encerrados */}
          {closedSplits.length > 0 && (
            <>
              <View style={[styles.sectionHeader, activeSplits.length > 0 && styles.sectionGap]}>
                <Eyebrow>
                  {t('split.sectionClosed')} · {closedSplits.length}
                </Eyebrow>
              </View>
              <View style={styles.cardList}>
                {closedSplits.map(sp => (
                  <SplitCard
                    key={sp.id}
                    split={sp}
                    onPress={() => openSplit(sp.id)}
                  />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  )
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <View style={sk.card}>
      <View style={sk.badgeRow}>
        <View style={sk.badge} />
        <View style={sk.expiry} />
      </View>
      <View style={sk.name} />
      <View style={sk.nameShort} />
      <View style={sk.bottomRow}>
        <View style={sk.avatarGroup} />
        <View style={sk.value} />
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SHIMMER = 'rgba(255,255,255,0.06)'

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  feedPad: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    gap: 10,
  },

  // Section headers
  sectionHeader: {
    marginBottom: spacing.sm,
  },
  sectionGap: {
    marginTop: 28,
  },
  cardList: {
    gap: 10,
  },

  // Create button (Header right)
  createBtn: {
    backgroundColor: colors.white[100],
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnText: {
    color: colors.black[100],
    fontSize: 12,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 12 * 0.04,
  },

  // Error state
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
  },

  // Empty state
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyCreateBtn: {
    marginTop: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCreateText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
})

const sk = StyleSheet.create({
  card: {
    padding: 16,
    backgroundColor: SHIMMER,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.04)',
    gap: 10,
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    width: 48,
    height: 16,
    borderRadius: spacing.radius.sm,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  expiry: {
    width: 72,
    height: 16,
    borderRadius: spacing.radius.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  name: {
    width: '70%',
    height: 14,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  nameShort: {
    width: '40%',
    height: 10,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  avatarGroup: {
    width: 88,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  value: {
    width: 64,
    height: 18,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
})
