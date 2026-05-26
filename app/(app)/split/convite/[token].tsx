// Design: /design/flows-split.jsx — (join flow via deep link)
// Spec: /specs/06_modules/split.md § 4 "Entrar em Split via link"
// Deep link: alber://split/convite/{token}
// Estados: preview, expirado, não encontrado, já participante

import { useState } from 'react'
import {
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
import { useBalanceStore } from '../../../../store/balance.store'
import { Header } from '../../../../components/core/Header'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { colors, spaceSkins } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

// ─── Mock — substituir por dados do auth store em produção ────────────────────

const JOINING_USER = {
  id:       'usr_current',
  name:     'Você',
  handle:   '@voce',
  initials: 'VC',
  blockedAmount: 0,
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SplitConviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { t }     = useTranslation()
  const insets    = useSafeAreaInsets()

  const splits    = useSplitStore(s => s.splits)
  const joinSplit = useSplitStore(s => s.joinSplit)
  const balance   = useBalanceStore(s => s.balance)

  const [joining, setJoining] = useState(false)

  // ── Lookup ────────────────────────────────────────────────────────────────────

  const split         = splits.find(sp => sp.inviteToken === token)
  const isExpired     = split ? new Date(split.expiresAt) < new Date() : false
  const isClosed      = split?.status !== 'active'
  const alreadyJoined = split?.participants.some(p => p.id === JOINING_USER.id) ?? false

  // ── Not found ─────────────────────────────────────────────────────────────────

  if (!split) {
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

  // ── Expired / closed ──────────────────────────────────────────────────────────

  if (isExpired || isClosed) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('split.convite.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>{t('split.convite.expiredTitle')}</Text>
          <Text style={styles.stateBody}>{t('split.convite.expiredBody')}</Text>
          <TouchableOpacity
            onPress={() => router.replace('/(app)/home')}
            style={[styles.ghostLink, { marginTop: spacing.sm }]}
          >
            <Text style={styles.ghostLinkText}>{t('split.convite.expiredGoHome')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Already joined ────────────────────────────────────────────────────────────

  if (alreadyJoined) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('split.convite.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>{t('split.convite.alreadyJoined')}</Text>
          <TouchableOpacity
            onPress={() => router.replace(`/(app)/split/${split.id}`)}
            style={[styles.ghostLink, { marginTop: spacing.sm }]}
          >
            <Text style={styles.ghostLinkText}>{t('split.convite.viewSplit')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const isFixed       = split.type === 'fixed'
  const accent        = isFixed ? spaceSkins.tech.accent : spaceSkins.surf.accent
  const acceptedCount = split.participants.filter(p => p.status === 'accepted').length
  const remaining     = split.totalValue - split.totalLaunched

  // Entry cost: fixed = totalValue / participantCount; variable = remaining / (accepted + 1)
  const entryCost = isFixed
    ? Math.ceil(split.totalValue / split.participantCount)
    : Math.ceil(remaining / (acceptedCount + 1))

  const hasSufficientBalance = balance >= entryCost

  // ── Actions ───────────────────────────────────────────────────────────────────

  function handleJoin() {
    if (!split) return
    if (!hasSufficientBalance) {
      router.push('/(app)/carregar')
      return
    }
    setJoining(true)
    joinSplit(split.id, JOINING_USER)
    router.replace(`/(app)/split/${split.id}`)
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
        <Text style={styles.splitName}>{split.name}</Text>

        {/* Owner */}
        <Text style={styles.ownerLabel}>
          {t('split.convite.owner', { handle: split.ownerHandle })}
        </Text>

        {/* Participant avatars */}
        <View style={styles.participantsRow}>
          {split.participants.slice(0, 5).map((p, i) => (
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
              total: split.participantCount,
            })}
          </Text>
        </View>

        {/* Expiry */}
        <Text style={styles.expiryLabel}>
          {t('split.convite.expires', { when: formatExpiry(split.expiresAt) })}
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
