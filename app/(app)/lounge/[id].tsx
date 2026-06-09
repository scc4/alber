// Design: /design/flows-rest.jsx — SpaceDetailScreen
// Spec: /specs/06_modules/alber_lounge.md § 5 "Tela de detalhe"
// Hero + eventos + mensagens + CTAs por papel

import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/auth.store'
import { useLoungeStore } from '../../../store/lounge.store'
import { EventCard } from '../../../components/lounge/EventCard'
import { Eyebrow } from '../../../components/shared/Eyebrow'
import { colors } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

// ─── Screen ───────────────────────────────────────────────────────────────────

const HERO_HEIGHT = 230

export default function LoungeDetailScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>()
  const { t }    = useTranslation()
  const insets   = useSafeAreaInsets()

  const token      = useAuthStore(s => s.token)
  const userId     = useAuthStore(s => s.user?.id ?? '')

  const getLoungeById  = useLoungeStore(s => s.getLoungeById)
  const fetchLounge    = useLoungeStore(s => s.fetchLounge)
  const joinLounge     = useLoungeStore(s => s.joinLounge)
  const setActive      = useLoungeStore(s => s.setCurrentLounge)
  const loading        = useLoungeStore(s => s.loading)
  const storeError     = useLoungeStore(s => s.error)

  const lounge = getLoungeById(id)

  const [joinSent, setJoinSent] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  useEffect(() => {
    if (id && token && userId) fetchLounge(id, userId, token)
  }, [id, token, userId])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading / not found ───────────────────────────────────────────────────────

  if (loading && !lounge) {
    return (
      <View style={styles.root}>
        <View style={[styles.heroBack, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerState}>
          <ActivityIndicator color="rgba(255,255,255,0.5)" />
        </View>
      </View>
    )
  }

  if (!lounge) {
    return (
      <View style={styles.root}>
        <View style={[styles.heroBack, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{storeError ?? 'Lounge não encontrado.'}</Text>
        </View>
      </View>
    )
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const isOwner   = lounge.role === 'owner'
  const isManager = lounge.role === 'owner' || lounge.role === 'manager'
  const isMember  = lounge.role !== null

  const roleLabel = isOwner
    ? t('lounge.roleOwner')
    : lounge.role === 'manager'
    ? t('lounge.roleManager')
    : t('lounge.roleMember')

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handleJoin() {
    if (!lounge || !token) return
    setJoinError(null)
    try {
      await joinLounge({ space_id: lounge.id }, token)
      setJoinSent(true)
    } catch (e: any) {
      setJoinError(e?.message ?? 'Erro ao entrar no Lounge')
    }
  }

  function handleSetActive() {
    if (!lounge) return
    setActive(lounge.id)
  }

  function handleEventPress(eventId: string) {
    if (!lounge) return
    if (isManager) {
      router.push(`/(app)/lounge/gerenciar/${lounge.id}`)
    } else {
      router.push(`/(app)/lounge/evento/${eventId}`)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <View style={[styles.hero, { backgroundColor: lounge.bgDark }]}>
        {lounge.imageUri ? (
          <Image
            source={{ uri: lounge.imageUri }}
            style={styles.heroCover}
            resizeMode="cover"
          />
        ) : null}
        <View style={styles.heroScrim} pointerEvents="none" />
        {isOwner && (
          <View
            style={[styles.heroGlow, { backgroundColor: `${lounge.accent}22` }]}
            pointerEvents="none"
          />
        )}

        {/* Back button */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { top: insets.top + 10 }]}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>

        {/* Bottom meta */}
        <View style={styles.heroMeta}>
          <View style={styles.heroBadgeRow}>
            <View style={[styles.accentDot, { backgroundColor: lounge.accent }]} />
            {isMember && (
              <View
                style={[
                  styles.roleBadge,
                  isOwner
                    ? { backgroundColor: `${lounge.accent}22`, borderColor: `${lounge.accent}55` }
                    : styles.roleBadgeMuted,
                ]}
              >
                <Text style={[styles.roleBadgeText, { color: isOwner ? lounge.accent : 'rgba(255,255,255,0.85)' }]}>
                  {roleLabel}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.heroName}>{lounge.name}</Text>
          <Text style={styles.heroMembers}>{t('lounge.members', { n: lounge.memberCount })}</Text>
        </View>
      </View>

      {/* ── Content ───────────────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, spacing.xl) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Description */}
        {lounge.description.length > 0 && (
          <Text style={styles.description}>{lounge.description}</Text>
        )}

        {/* CTA row */}
        <View style={styles.ctaRow}>
          {/* Primary action */}
          {isManager ? (
            <TouchableOpacity
              onPress={() => router.push(`/(app)/lounge/gerenciar/${lounge.id}`)}
              style={styles.ctaPrimary}
              activeOpacity={0.8}
            >
              <Text style={styles.ctaPrimaryText}>{t('lounge.manageCta')}</Text>
            </TouchableOpacity>
          ) : isMember ? (
            <View style={styles.ctaMemberBadge}>
              <Text style={styles.ctaMemberText}>{t('lounge.memberCta')}</Text>
            </View>
          ) : joinSent ? (
            <View style={styles.ctaPendingBadge}>
              <Text style={styles.ctaPendingText}>{t('lounge.requestPending')}</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={handleJoin}
              style={styles.ctaPrimary}
              activeOpacity={0.8}
            >
              <Text style={styles.ctaPrimaryText}>{t('lounge.joinCta')}</Text>
            </TouchableOpacity>
          )}

          {/* Set active */}
          {isMember && (
            <TouchableOpacity
              onPress={handleSetActive}
              style={styles.ctaSecondary}
              activeOpacity={0.8}
            >
              <Text style={styles.ctaSecondaryText}>{t('lounge.setActiveCta')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {joinError && (
          <Text style={styles.joinError}>{joinError}</Text>
        )}

        {/* ── Events ──────────────────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Eyebrow>{t('lounge.eventsSection')}</Eyebrow>
          {isManager && (
            <TouchableOpacity
              onPress={() => router.push(`/(app)/lounge/criar-evento/${lounge.id}`)}
              accessibilityRole="button"
            >
              <Text style={[styles.createEventLink, { color: lounge.accent }]}>
                {t('lounge.createEventCta')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {lounge.events.filter(e => e.status === 'active').length === 0 ? (
          <Text style={styles.emptyEvents}>{t('lounge.noEvents')}</Text>
        ) : (
          <View style={styles.eventList}>
            {lounge.events
              .filter(e => e.status === 'active')
              .map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  accent={lounge.accent}
                  isManager={isManager}
                  onPress={() => handleEventPress(event.id)}
                />
              ))}
          </View>
        )}

        {/* ── Messages ────────────────────────────────────────────────────────── */}
        {lounge.messages.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Eyebrow>{t('lounge.messagesSection')}</Eyebrow>
            </View>

            <View style={[styles.messagesFeed, { borderColor: `${lounge.accent}25`, backgroundColor: `${lounge.accent}08` }]}>
              {lounge.messages.slice(0, 3).map((msg, i) => (
                <View
                  key={msg.id}
                  style={[styles.messageItem, i > 0 && { borderTopWidth: 0.5, borderTopColor: `${lounge.accent}18` }]}
                >
                  <View style={styles.msgMeta}>
                    <View style={[styles.msgAvatar, { backgroundColor: avatarHue(msg.authorHandle) }]}>
                      <Text style={styles.msgAvatarText}>{msg.authorInitials[0]}</Text>
                    </View>
                    <View style={styles.msgAuthorWrap}>
                      <Text style={[styles.msgAuthor, { color: `${lounge.accent}cc` }]}>
                        {msg.authorName}
                        <Text style={styles.msgRole}> · {msg.role === 'owner' ? t('lounge.roleOwner') : t('lounge.roleManager')}</Text>
                      </Text>
                      <Text style={styles.msgTime}>{formatDate(msg.createdAt)}</Text>
                    </View>
                  </View>
                  <Text style={styles.msgContent}>{msg.content}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarHue(handle: string): string {
  const h = ((handle.charCodeAt(1) ?? 65) * 23) % 360
  return `hsl(${h}, 18%, 22%)`
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffH = Math.floor(diffMs / 3_600_000)
    if (diffH < 1) return 'agora'
    if (diffH < 24) return `há ${diffH}h`
    const diffD = Math.floor(diffH / 24)
    if (diffD === 1) return 'ontem'
    return `há ${diffD} dias`
  } catch {
    return ''
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },

  // Hero
  hero: {
    height: HERO_HEIGHT,
    flexShrink: 0,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  heroCover: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  heroScrim: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  heroGlow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  backBtn: {
    position: 'absolute',
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  backArrow: {
    fontSize: 20,
    color: colors.white[100],
    marginTop: -2,
  },
  heroMeta: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 18,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 7,
  },
  accentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  roleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 0.5,
  },
  roleBadgeMuted: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  roleBadgeText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 9 * 0.14,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  heroName: {
    fontSize: 27,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -27 * 0.02,
  },
  heroMembers: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  heroBack: {
    height: HERO_HEIGHT,
    backgroundColor: colors.black[90],
    position: 'relative',
  },

  // Content
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 20,
  },
  description: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 21,
    marginBottom: 20,
  },

  // CTAs
  ctaRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 28,
  },
  ctaPrimary: {
    flex: 2,
    paddingVertical: 12,
    backgroundColor: colors.white[100],
    borderRadius: 10,
    alignItems: 'center',
  },
  ctaPrimaryText: {
    fontSize: 12.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.black[100],
    letterSpacing: 12.5 * 0.03,
  },
  ctaSecondary: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    alignItems: 'center',
  },
  ctaSecondaryText: {
    fontSize: 12.5,
    fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  ctaMemberBadge: {
    flex: 2,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    alignItems: 'center',
  },
  ctaMemberText: {
    fontSize: 12.5,
    fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.65)',
  },
  ctaPendingBadge: {
    flex: 2,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    alignItems: 'center',
  },
  ctaPendingText: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 10 * 0.1,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  createEventLink: {
    fontSize: 11.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 11.5 * 0.04,
  },

  // Events
  eventList: {
    gap: 8,
    marginBottom: 28,
  },
  emptyEvents: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    paddingVertical: 20,
    marginBottom: 28,
  },

  // Messages
  messagesFeed: {
    borderWidth: 0.5,
    borderRadius: 12,
    overflow: 'hidden',
  },
  messageItem: {
    padding: 14,
    gap: 8,
  },
  msgMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  msgAvatarText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  msgAuthorWrap: { flex: 1 },
  msgAuthor: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    letterSpacing: 11 * 0.04,
  },
  msgRole: {
    fontWeight: '400',
    color: 'rgba(255,255,255,0.4)',
  },
  msgTime: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 1,
  },
  msgContent: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
  },

  joinError: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
    marginBottom: 12,
    marginTop: -12,
  },

  // Error state
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
  },
})
