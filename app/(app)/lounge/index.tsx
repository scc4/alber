// Design: /design/flows-rest.jsx — SpacesScreen
// Spec: /specs/06_modules/alber_lounge.md § 5 "Tela principal"
// Tabs: Meus Lounges | Explorar — busca no Explorar

import { useCallback, useEffect, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/auth.store'
import { useLoungeStore } from '../../../store/lounge.store'
import { LoungeCard } from '../../../components/lounge/LoungeCard'
import { Header } from '../../../components/core/Header'
import { colors } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

// ─── Screen ───────────────────────────────────────────────────────────────────

type Tab = 'mine' | 'explore'

export default function LoungeIndexScreen() {
  const { t }   = useTranslation()
  const insets  = useSafeAreaInsets()

  const token              = useAuthStore(s => s.token)
  const myLounges          = useLoungeStore(s => s.myLounges)
  const exploring          = useLoungeStore(s => s.exploring)
  const loading            = useLoungeStore(s => s.loading)
  const error              = useLoungeStore(s => s.error)
  const fetchMyLounges     = useLoungeStore(s => s.fetchMyLounges)
  const fetchExploring     = useLoungeStore(s => s.fetchExploring)
  const hasActiveLoungeAsOwner = useLoungeStore(s => s.hasActiveLoungeAsOwner)

  const [tab, setTab]           = useState<Tab>('mine')
  const [query, setQuery]       = useState('')
  const [tooltip, setTooltip]   = useState(false)

  const isOwner = hasActiveLoungeAsOwner()

  useEffect(() => {
    if (token) fetchMyLounges(token)
  }, [token])

  useEffect(() => {
    if (tab === 'explore') fetchExploring(query, token ?? '')
  }, [tab, query, token])

  const handleCreate = useCallback(() => {
    if (isOwner) {
      setTooltip(true)
      setTimeout(() => setTooltip(false), 2500)
    } else {
      router.push('/(app)/lounge/criar')
    }
  }, [isOwner])

  const openLounge = useCallback((id: string) => {
    router.push(`/(app)/lounge/${id}`)
  }, [])

  return (
    <View style={styles.root}>
      <Header variant="title" title={t('lounge.title')} />

      {/* Tab switcher */}
      <View style={styles.tabBar}>
        {(['mine', 'explore'] as Tab[]).map(k => (
          <TouchableOpacity
            key={k}
            onPress={() => setTab(k)}
            style={[styles.tabBtn, tab === k && styles.tabBtnActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
          >
            <Text style={[styles.tabLabel, tab === k && styles.tabLabelActive]}>
              {k === 'mine' ? t('lounge.tabMine') : t('lounge.tabExplore')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Explore: search field */}
      {tab === 'explore' && (
        <View style={styles.searchWrap}>
          <SearchIcon />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('lounge.searchPlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      )}

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom + 24, spacing.xl) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Mine tab: criar button */}
        {tab === 'mine' && (
          <View style={styles.createWrap}>
            <TouchableOpacity
              onPress={handleCreate}
              activeOpacity={0.8}
              style={[styles.createBtn, isOwner && styles.createBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('lounge.createCta')}
            >
              <PlusIcon disabled={isOwner} />
              <Text style={[styles.createBtnText, isOwner && styles.createBtnTextDisabled]}>
                {t('lounge.createCta')}
              </Text>
              {isOwner && <LockIcon />}
            </TouchableOpacity>

            {tooltip && (
              <View style={styles.tooltip}>
                <Text style={styles.tooltipText}>{t('lounge.createDisabledTooltip')}</Text>
              </View>
            )}
          </View>
        )}

        {/* Loading */}
        {loading && (
          <Text style={styles.loadingText}>…</Text>
        )}

        {/* Error */}
        {!loading && error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        {/* Empty state */}
        {!loading && tab === 'mine' && myLounges.length === 0 && (
          <Text style={styles.emptyText}>{t('lounge.tabMine')}</Text>
        )}
        {!loading && tab === 'explore' && exploring.length === 0 && (
          <Text style={styles.emptyText}>{t('lounge.tabExplore')}</Text>
        )}

        {/* Mine: two sections */}
        {tab === 'mine' && (() => {
          const owned   = myLounges.filter(l => l.role === 'owner')
          const member  = myLounges.filter(l => l.role !== 'owner')
          return (
            <>
              {owned.length > 0 && (
                <>
                  <SectionLabel>{t('lounge.sectionOwned')}</SectionLabel>
                  {owned.map(lounge => (
                    <LoungeCard
                      key={lounge.id}
                      lounge={lounge}
                      onPress={() => openLounge(lounge.id)}
                    />
                  ))}
                </>
              )}
              {member.length > 0 && (
                <>
                  <SectionLabel>{t('lounge.sectionMember')}</SectionLabel>
                  {member.map(lounge => (
                    <LoungeCard
                      key={lounge.id}
                      lounge={lounge}
                      onPress={() => openLounge(lounge.id)}
                    />
                  ))}
                </>
              )}
            </>
          )
        })()}

        {/* Explore: flat list */}
        {tab === 'explore' && exploring.map(lounge => (
          <LoungeCard
            key={lounge.id}
            lounge={lounge}
            onPress={() => openLounge(lounge.id)}
          />
        ))}
      </ScrollView>
    </View>
  )
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={sectionLabelStyle}>{children}</Text>
  )
}

const sectionLabelStyle: import('react-native').TextStyle = {
  fontSize: 10,
  fontFamily: typography.fontFamily.primary,
  fontWeight: '500',
  letterSpacing: 10 * 0.1,
  color: 'rgba(255,255,255,0.35)',
  textTransform: 'uppercase',
  marginBottom: 10,
  marginTop: 4,
}

// ─── Inline icons (SVG-free RN equivalents) ───────────────────────────────────

function PlusIcon({ disabled }: { disabled: boolean }) {
  const color = disabled ? 'rgba(255,255,255,0.3)' : colors.white[100]
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: 14, height: 1.4, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', width: 1.4, height: 14, backgroundColor: color, borderRadius: 1 }} />
    </View>
  )
}

function LockIcon() {
  return (
    <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
      <View style={[lockStyles.shackle]} />
      <View style={lockStyles.body} />
    </View>
  )
}

function SearchIcon() {
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      <View style={searchIconStyles.circle} />
      <View style={searchIconStyles.handle} />
    </View>
  )
}

const lockStyles = StyleSheet.create({
  shackle: {
    width: 7, height: 5,
    borderTopLeftRadius: 4, borderTopRightRadius: 4,
    borderWidth: 1.1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.5)',
    marginBottom: -1,
  },
  body: {
    width: 9, height: 5.5,
    borderRadius: 1.5,
    borderWidth: 1.1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
})

const searchIconStyles = StyleSheet.create({
  circle: {
    position: 'absolute', top: 0, left: 0,
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 1.3, borderColor: 'rgba(255,255,255,0.5)',
  },
  handle: {
    position: 'absolute', bottom: 0, right: 0,
    width: 4, height: 1.3,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 1,
    transform: [{ rotate: '45deg' }, { translateX: -1 }, { translateY: -1 }],
  },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    gap: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  tabLabel: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
    color: colors.white[100],
    opacity: 0.55,
  },
  tabLabelActive: {
    opacity: 1,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
  },

  // Create button
  createWrap: {
    marginBottom: 14,
    position: 'relative',
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.25)',
  },
  createBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  createBtnText: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
    color: colors.white[100],
    letterSpacing: 13.5 * 0.01,
  },
  createBtnTextDisabled: {
    color: 'rgba(255,255,255,0.35)',
  },

  // Tooltip
  tooltip: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 6,
    padding: 10,
    backgroundColor: '#1a1a1a',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    zIndex: 10,
  },
  tooltipText: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 16,
  },

  // States
  loadingText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  errorText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
})
