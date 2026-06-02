// Design: /design/flows-split.jsx — (join flow via deep link)
// Spec: /specs/06_modules/split.md § 4 "Entrar em Split via link"
// Deep link: alber://split/convite/{token}
// Estados: loading, preview, não encontrado/expirado, já participante

import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useSplitStore } from '../../../../store/split.store'
import { useAuthStore } from '../../../../store/auth.store'
import { useBalanceStore } from '../../../../store/balance.store'
import * as splitService from '../../../../services/split.service'
import type { Split } from '../../../../store/split.store'
import { Header } from '../../../../components/core/Header'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { colors, spaceSkins } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SplitConviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { t }     = useTranslation()
  const insets    = useSafeAreaInsets()

  const joinSplitStore = useSplitStore(s => s.joinSplit)
  const fetchSplit     = useSplitStore(s => s.fetchSplit)
  const authToken      = useAuthStore(s => s.token)
  const currentUserId  = useAuthStore(s => s.user?.id ?? '')
  const balance        = useBalanceStore(s => s.balance)

  const [preview, setPreview]               = useState<Split | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [previewError, setPreviewError]     = useState<string | null>(null)
  const [joining, setJoining]               = useState(false)
  const [joinError, setJoinError]           = useState<string | null>(null)

  // ── Fetch preview ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!token || !authToken) return
    setLoadingPreview(true)
    splitService.getSplitByToken(token, authToken)
      .then(data => setPreview(data))
      .catch(e => setPreviewError(e instanceof Error ? e.message : 'Erro ao carregar convite'))
      .finally(() => setLoadingPreview(false))
  }, [token, authToken])

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (loadingPreview) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('split.convite.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <ActivityIndicator color="rgba(255,255,255,0.5)" />
        </View>
      </View>
    )
  }

  // ── Not found / expired ───────────────────────────────────────────────────────
  // RPC only returns open, non-expired splits — null means not found or expired

  if (!preview || previewError) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('split.convite.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>{t('split.convite.notFoundTitle')}</Text>
          <Text style={styles.stateBody}>{t('split.convite.notFoundBody')}</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.ghostLink}>
            <Text style={styles.ghostLinkText}>‹ Voltar</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Already joined ────────────────────────────────────────────────────────────

  const alreadyJoined = preview.participants.some(p => p.id === currentUserId)

  if (alreadyJoined) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('split.convite.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>{t('split.convite.alreadyJoined')}</Text>
          <TouchableOpacity
            onPress={() => router.replace(`/(app)/split/${preview.id}`)}
            style={[styles.ghostLink, { marginTop: spacing.sm }]}
          >
            <Text style={styles.ghostLinkText}>{t('split.convite.viewSplit')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const isFixed       = preview.type === 'fixed'
  const accent        = isFixed ? spaceSkins.tech.accent : spaceSkins.surf.accent
  const acceptedCount = preview.participants.filter(p => p.status === 'accepted').length
  const remaining     = preview.totalValue - preview.totalLaunched

  // Entry cost: fixed = totalValue / participantCount; variable = remaining / (accepted + 1)
  const entryCost = isFixed
    ? Math.ceil(preview.totalValue / preview.participantCount)
    : Math.ceil(remaining / (acceptedCount + 1))

  const hasSufficientBalance = balance >= entryCost

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function handleJoin() {
    if (!preview || !authToken) return
    if (!hasSufficientBalance) {
      router.push('/(app)/carregar')
      return
    }
    setJoining(true)
    setJoinError(null)
    try {
      await joinSplitStore(token, authToken)
      await fetchSplit(preview.id, authToken)
      router.replace(`/(app)/split/${preview.id}`)
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Erro ao entrar no split')
    } finally {
      setJoining(false)
    }
  }

  // ── Render: preview ───────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={t('split.convite.title')}
        onBack={() => router.back()}
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 100, 120) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Type badge */}
        <View style={[styles.typeBadge, { borderColor: `${accent}4D` }]}>
          <Text style={[styles.typeBadgeText, { color: accent }]}>
            {t(isFixed ? 'split.convite.typeFixed' : 'split.convite.typeVariable')}
          </Text>
        </View>

        {/* Split name */}
        <Text style={styles.splitName}>{preview.name}</Text>

        {/* Owner */}
        <Text style={styles.ownerLabel}>
          {t('split.convite.owner', { handle: preview.ownerHandle })}
        </Text>

        {/* Participant avatars */}
        <View style={styles.participantsRow}>
          {preview.participants.slice(0, 5).map((p, i) => (
            <View
              key={p.id}
              style={[
                styles.avatarChip,
                { marginLeft: i === 0 ? 0 : -8, backgroundColor: avatarHue(p.handle) },
              ]}
            >
              <Text style={styles.avatarInitial}>{p.initials[0]}</Text>
            </View>
          ))}
          <Text style={styles.participantsLabel}>
            {t('split.convite.participants', {
              accepted: acceptedCount,
              total: preview.participantCount,
            })}
          </Text>
        </View>

        {/* Expiry */}
        <Text style={styles.expiryLabel}>
          {t('split.convite.expires', { when: formatExpiry(preview.expiresAt) })}
        </Text>

        {/* Entry cost card */}
        <View
          style={[
            styles.costCard,
            {
              backgroundColor: `${accent}0F`,
              borderColor: `${accent}2E`,
            },
          ]}
        >
          <Text style={[styles.costLabel, { color: `${accent}B3` }]}>
            {t(isFixed ? 'split.convite.yourCost' : 'split.convite.yourBlock')}
          </Text>
          <View style={styles.costValueRow}>
            <Text style={[styles.costValue, { color: accent }]}>{entryCost}</Text>
            <Text style={[styles.costUnit, { color: `${accent}99` }]}>
              {' '}{t('split.convite.amountUnit')}
            </Text>
          </View>
          {!isFixed && (
            <Text style={styles.costHint}>
              Reservado no seu saldo. Liberado conforme conta for definida.
            </Text>
          )}
        </View>

        {/* Balance check */}
        <View
          style={[
            styles.balanceCheck,
            hasSufficientBalance ? styles.balanceOk : styles.balanceBad,
          ]}
        >
          <Text
            style={[
              styles.balanceText,
              { color: hasSufficientBalance ? '#22C55E' : colors.state.error },
            ]}
          >
            {t(
              hasSufficientBalance
                ? 'split.convite.balanceSufficient'
                : 'split.convite.balanceInsufficient',
            )}
          </Text>
        </View>

        {/* Join error */}
        {joinError && (
          <Text style={styles.joinErrorText}>{joinError}</Text>
        )}
      </ScrollView>

      {/* Bottom CTAs */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PrimaryButton
          label={
            hasSufficientBalance
              ? t('split.convite.joinCta')
              : t('split.convite.loadCta')
          }
          onPress={handleJoin}
          state={joining ? 'loading' : 'default'}
        />
        <Pressable onPress={() => router.back()} style={styles.declineBtn} hitSlop={8}>
          <Text style={styles.declineBtnText}>{t('split.convite.declineCta')}</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarHue(handle: string): string {
  const h = ((handle.charCodeAt(1) ?? 65) * 23) % 360
  return `hsl(${h}, 18%, 22%)`
}

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  const h  = Math.floor(ms / 3_600_000)
  if (h < 1)  return 'em menos de 1h'
  if (h < 24) return `em ${h}h`
  const d = Math.floor(h / 24)
  return `em ${d} ${d === 1 ? 'dia' : 'dias'}`
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  // Center states
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 19,
  },
  ghostLink: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  ghostLinkText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
  },

  // Preview
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 0.5,
    borderRadius: 4,
    marginBottom: 12,
  },
  typeBadgeText: {
    fontSize: 9.5,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 9.5 * 0.14,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  splitName: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -26 * 0.02,
    marginBottom: 6,
  },
  ownerLabel: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 16,
  },
  participantsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.black[100],
  },
  avatarInitial: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  participantsLabel: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    marginLeft: 10,
  },
  expiryLabel: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 20,
  },

  // Cost card
  costCard: {
    padding: 16,
    borderWidth: 0.5,
    borderRadius: spacing.radius.md,
    marginBottom: 12,
    gap: 4,
  },
  costLabel: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 11 * 0.1,
    textTransform: 'uppercase',
  },
  costValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  costValue: {
    fontSize: 32,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -32 * 0.02,
    fontVariant: ['tabular-nums'],
  },
  costUnit: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
  },
  costHint: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 15,
    marginTop: 4,
  },

  // Balance check
  balanceCheck: {
    padding: 10,
    borderRadius: spacing.radius.sm,
    alignItems: 'center',
  },
  balanceOk: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(34,197,94,0.2)',
  },
  balanceBad: {
    backgroundColor: 'rgba(239,68,68,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(239,68,68,0.22)',
  },
  balanceText: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
  },
  joinErrorText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.black[100],
    gap: spacing.sm,
  },
  declineBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  declineBtnText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
  },
})
