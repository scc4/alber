import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Modal,
  Pressable,
  Share,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import * as SecureStore from 'expo-secure-store'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing, layout } from '../../tokens/spacing'

interface AlberUser {
  id: string
  name: string
  handle: string
  memberSince: string
}

const MOCK_USERS: AlberUser[] = [
  { id: 'u1', name: 'João Silva Pereira', handle: '@joaosilva',    memberSince: 'jan/2024' },
  { id: 'u2', name: 'Ana Maria Costa',    handle: '@ana_costa',    memberSince: 'mar/2024' },
  { id: 'u3', name: 'Pedro Henrique',     handle: '@phenrique',    memberSince: 'fev/2023' },
  { id: 'u4', name: 'Camila Rocha',       handle: '@cami',         memberSince: 'mai/2024' },
  { id: 'u5', name: 'Lucas Ferreira',     handle: '@lucas_f',      memberSince: 'jun/2023' },
  { id: 'u6', name: 'Marina Santos',      handle: '@marinasantos', memberSince: 'abr/2024' },
  { id: 'u7', name: 'Rafael Oliveira',    handle: '@rafa',         memberSince: 'jan/2023' },
  { id: 'u8', name: 'Beatriz Lima',       handle: '@beatriz_lima', memberSince: 'out/2023' },
]

const HISTORY_KEY = 'achar_history'
const MAX_HISTORY = 10
const MIN_QUERY   = 2
const DEBOUNCE_MS = 300

function avatarHue(handle: string): number {
  return (handle.charCodeAt(1) * 23) % 360
}

// ── Avatar ──────────────────────────────────────────────────────────────────

interface AvatarProps { name: string; handle: string; size?: number }

function Avatar({ name, handle, size = 38 }: AvatarProps) {
  const hue = avatarHue(handle)
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue}, 18%, 22%)` },
      ]}
    >
      <Text style={[styles.avatarInitial, { fontSize: size * 0.37 }]}>
        {name[0].toUpperCase()}
      </Text>
    </View>
  )
}

// ── UserRow ──────────────────────────────────────────────────────────────────

interface UserRowProps { user: AlberUser; onPress: (u: AlberUser) => void }

function UserRow({ user, onPress }: UserRowProps) {
  return (
    <TouchableOpacity style={styles.row} onPress={() => onPress(user)} activeOpacity={0.65}>
      <Avatar name={user.name} handle={user.handle} />
      <View style={styles.rowMeta}>
        <Text style={styles.rowName}>{user.name}</Text>
        <Text style={styles.rowHandle}>{user.handle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  )
}

// ── ProfileSheet ─────────────────────────────────────────────────────────────

interface ProfileSheetProps {
  user: AlberUser | null
  onClose: () => void
}

function ProfileSheet({ user, onClose }: ProfileSheetProps) {
  const { t } = useTranslation()

  const handleShare = useCallback(async () => {
    if (!user) return
    await Share.share({ message: `${user.handle} no Alber` })
  }, [user])

  return (
    <Modal visible={!!user} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {user && (
            <>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>{t('achar.profileTitle')}</Text>

              <Avatar name={user.name} handle={user.handle} size={72} />

              <Text style={styles.profileName}>{user.name}</Text>
              <Text style={styles.profileHandle}>{user.handle}</Text>
              <Text style={styles.profileSince}>
                {t('achar.memberSince', { date: user.memberSince })}
              </Text>

              <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.75}>
                <Text style={styles.shareBtnText}>{t('achar.shareHandle')}</Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function AcharScreen() {
  const { t } = useTranslation()

  const [q, setQ]               = useState('')
  const [results, setResults]   = useState<AlberUser[]>([])
  const [history, setHistory]   = useState<AlberUser[]>([])
  const [loading, setLoading]   = useState(false)
  const [searched, setSearched] = useState(false)
  const [profile, setProfile]   = useState<AlberUser | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load history from SecureStore
  useEffect(() => {
    SecureStore.getItemAsync(HISTORY_KEY).then(raw => {
      if (!raw) return
      try { setHistory(JSON.parse(raw)) } catch {}
    })
  }, [])

  const persistHistory = useCallback((list: AlberUser[]) => {
    SecureStore.setItemAsync(HISTORY_KEY, JSON.stringify(list)).catch(() => {})
  }, [])

  const addToHistory = useCallback((user: AlberUser) => {
    setHistory(prev => {
      const without = prev.filter(u => u.id !== user.id)
      const updated = [user, ...without].slice(0, MAX_HISTORY)
      persistHistory(updated)
      return updated
    })
  }, [persistHistory])

  const clearHistory = useCallback(() => {
    setHistory([])
    SecureStore.deleteItemAsync(HISTORY_KEY).catch(() => {})
  }, [])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = q.trim().replace(/^@/, '').toLowerCase()
    if (trimmed.length < MIN_QUERY) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(() => {
      const found = MOCK_USERS.filter(u =>
        u.handle.toLowerCase().replace('@', '').includes(trimmed) ||
        u.name.toLowerCase().includes(trimmed)
      )
      setResults(found)
      setSearched(true)
      setLoading(false)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  const handleUserPress = useCallback((user: AlberUser) => {
    addToHistory(user)
    setProfile(user)
  }, [addToHistory])

  const isSearching  = q.trim().replace(/^@/, '').length >= MIN_QUERY
  const showResults  = isSearching && searched
  const showRecents  = !isSearching
  const displayList  = showResults ? results : history
  const sectionLabel = showResults ? t('achar.sectionResults') : t('achar.sectionRecent')

  const emptyText = showResults
    ? t('achar.emptyResults', { q: q.trim().replace(/^@/, '') })
    : t('achar.emptyHistory')

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('achar.title')}</Text>
        </View>

        {/* Search field */}
        <View style={styles.searchWrap}>
          <View style={styles.searchField}>
            <SearchIcon />
            <TextInput
              style={styles.searchInput}
              value={q}
              onChangeText={setQ}
              placeholder={t('achar.placeholder')}
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {loading && (
              <ActivityIndicator size="small" color={colors.gray[500]} />
            )}
            {q.length > 0 && !loading && (
              <TouchableOpacity onPress={() => setQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.clearIcon}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* List */}
        <FlatList
          data={displayList}
          keyExtractor={u => u.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.sectionHeader}>
              <Text style={styles.eyebrow}>{sectionLabel}</Text>
              {showRecents && history.length > 0 && (
                <TouchableOpacity onPress={clearHistory} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.clearHistory}>{t('achar.clearHistory')}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <UserRow user={item} onPress={handleUserPress} />
          )}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.emptyText}>{emptyText}</Text>
            ) : null
          }
        />
      </KeyboardAvoidingView>

      <ProfileSheet user={profile} onClose={() => setProfile(null)} />
    </SafeAreaView>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <View style={{ width: 14, height: 14, justifyContent: 'center', alignItems: 'center' }}>
      {/* circle */}
      <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1.3, borderColor: 'rgba(255,255,255,0.4)', position: 'absolute', top: 0, left: 0 }} />
      {/* stem */}
      <View style={{ width: 1.3, height: 4, backgroundColor: 'rgba(255,255,255,0.4)', position: 'absolute', bottom: 0, right: 0, borderRadius: 1, transform: [{ rotate: '-45deg' }] }} />
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: {
    flex: 1,
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
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 11,
  },
  searchInput: {
    flex: 1,
    ...typography.size.label,
    color: colors.white[100],
    padding: 0,
  },
  clearIcon: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.bottomNavHeight + spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
  },
  clearHistory: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.4)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontWeight: typography.weight.bold,
    color: colors.white[100],
  },
  rowMeta: {
    flex: 1,
  },
  rowName: {
    ...typography.size.label,
    color: colors.white[100],
  },
  rowHandle: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  chevron: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.2)',
  },
  emptyText: {
    ...typography.size.bodySmall,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 22,
    paddingHorizontal: spacing.md,
  },
  // Profile sheet
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.black[90],
    borderTopLeftRadius: layout.sheetBorderRadius,
    borderTopRightRadius: layout.sheetBorderRadius,
    paddingHorizontal: layout.sheetPaddingH,
    paddingTop: layout.sheetPaddingTop,
    paddingBottom: layout.sheetPaddingBottom,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.lg,
  },
  profileName: {
    ...typography.size.h1,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    marginTop: spacing.md,
    letterSpacing: -0.3,
  },
  profileHandle: {
    ...typography.size.label,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 4,
  },
  profileSince: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.35)',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  shareBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 13,
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  shareBtnText: {
    ...typography.size.label,
    fontWeight: typography.weight.medium,
    color: colors.white[100],
  },
})
