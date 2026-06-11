// Spec: /specs/06_modules/alber_lounge.md § 6 "Entrada — Lounge privado"
// Deep link: alber://lounge/convite/{invite_token}
// Preview do lounge + botão Entrar → lounge-join via invite_token

import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../../store/auth.store'
import { useLoungeStore } from '../../../../store/lounge.store'
import * as loungeService from '../../../../services/lounge.service'
import type { InvitePreview } from '../../../../services/lounge.service'
import { colors } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ConviteScreen() {
  const { token: inviteToken } = useLocalSearchParams<{ token: string }>()
  const { t }    = useTranslation()
  const insets   = useSafeAreaInsets()

  const authToken  = useAuthStore(s => s.token)
  const userId     = useAuthStore(s => s.user?.id ?? '')
  const joinLounge = useLoungeStore(s => s.joinLounge)
  const fetchLounge = useLoungeStore(s => s.fetchLounge)

  const [preview, setPreview]   = useState<InvitePreview | null>(null)
  const [loading, setLoading]   = useState(true)
  const [joining, setJoining]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // ── Redirect se não autenticado ────────────────────────────────────────────

  useEffect(() => {
    if (!authToken) {
      router.replace('/(auth)/welcome')
    }
  }, [authToken])

  // ── Buscar preview via invite_token ────────────────────────────────────────

  useEffect(() => {
    if (!inviteToken || !authToken) return
    let cancelled = false
    setLoading(true)
    loungeService.getInvitePreview(inviteToken, authToken).then(data => {
      if (cancelled) return
      if (!data) setError(t('lounge.convite.notFound'))
      else setPreview(data)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setError(t('lounge.convite.notFound'))
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [inviteToken, authToken])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Entrar no lounge ───────────────────────────────────────────────────────

  async function handleJoin() {
    if (!inviteToken || !authToken || !preview) return
    setJoining(true)
    setError(null)
    try {
      const res = await joinLounge({ invite_token: inviteToken }, authToken)
      await fetchLounge(res.space_id, userId, authToken)
      router.replace(`/(app)/lounge/${res.space_id}`)
    } catch (e: any) {
      setError(e?.message ?? t('lounge.convite.errorJoin'))
      setJoining(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const accent = (preview?.skin?.accent as string | undefined) ?? '#5BCEC9'

  return (
    <View style={styles.root}>
      {/* Back */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={[styles.backBtn, { top: insets.top + 14 }]}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
      >
        <Text style={styles.backArrow}>‹</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="rgba(255,255,255,0.5)" />
          <Text style={styles.loadingText}>{t('lounge.convite.loading')}</Text>
        </View>
      ) : error && !preview ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : preview ? (
        <>
          {/* Hero */}
          <View style={[styles.hero, { backgroundColor: '#0a0a0a' }]}>
            {preview.image_url ? (
              <Image source={{ uri: preview.image_url }} style={styles.heroCover} resizeMode="cover" />
            ) : null}
            <View style={styles.heroScrim} pointerEvents="none" />
            <View style={[styles.heroGlow, { backgroundColor: `${accent}1a` }]} pointerEvents="none" />
            <View style={styles.heroMeta}>
              <View style={styles.heroBadgeRow}>
                <View style={[styles.accentDot, { backgroundColor: accent }]} />
                <View style={[styles.privateBadge, { backgroundColor: `${accent}18`, borderColor: `${accent}44` }]}>
                  <Text style={[styles.privateBadgeText, { color: accent }]}>
                    {t('lounge.convite.privateLabel')}
                  </Text>
                </View>
              </View>
              <Text style={styles.heroName}>{preview.name}</Text>
              <Text style={styles.heroMembers}>
                {t('lounge.convite.memberCount', { n: preview.member_count })}
              </Text>
            </View>
          </View>

          {/* Content */}
          <View style={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, spacing.xl) }]}>
            {preview.description ? (
              <Text style={styles.description}>{preview.description}</Text>
            ) : null}

            {error ? (
              <Text style={styles.joinError}>{error}</Text>
            ) : null}

            <TouchableOpacity
              onPress={handleJoin}
              style={[styles.joinBtn, joining && styles.joinBtnLoading]}
              activeOpacity={0.85}
              disabled={joining}
            >
              {joining ? (
                <ActivityIndicator color={colors.black[100]} size="small" />
              ) : (
                <Text style={styles.joinBtnText}>{t('lounge.convite.joinCta')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const HERO_HEIGHT = 280

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },

  backBtn: {
    position: 'absolute',
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
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

  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
  },

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
  heroMeta: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 20,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  accentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  privateBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 0.5,
  },
  privateBadgeText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    letterSpacing: 9 * 0.14,
    textTransform: 'uppercase',
  },
  heroName: {
    fontSize: 30,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -30 * 0.02,
  },
  heroMembers: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },

  // Content
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 24,
    gap: 16,
  },
  description: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 21,
  },
  joinError: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
  },
  joinBtn: {
    height: spacing.buttonHeight,
    backgroundColor: colors.white[100],
    borderRadius: spacing.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnLoading: {
    opacity: 0.75,
  },
  joinBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.black[100],
    letterSpacing: 12.5 * 0.03,
  },
})
