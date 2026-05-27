// Design: /design/flows1.jsx — HomeScreen
// Spec: /specs/06_modules/home.md
// Shell fixa (Header, Saldo, Actions, BottomNav) + skin variável do Lounge ativo
// Mock: skin 'surf' fixo — será dinâmico com lounge.store no Sprint 5

import React, { useCallback, useEffect, useState } from 'react'
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Header } from '../../components/core/Header'
import { BottomNav } from '../../components/core/BottomNav'
import { BalanceBlock } from '../../components/financial/BalanceBlock'
import { Eyebrow } from '../../components/shared/Eyebrow'
import { useAuthStore } from '../../store/auth.store'
import { useBalanceStore } from '../../store/balance.store'
import { spaceSkins } from '../../tokens/colors'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Banner logic ────────────────────────────────────────────────────────────

type BannerData = {
  tone: 'warning' | 'error' | 'info'
  text: string
  cta: string
  dismissible: boolean
  target: string
}

function resolveBanner(
  kycStatus: string,
  accountStatus: string,
  dismissed: boolean,
  t: (k: string) => string,
): BannerData | null {
  if (kycStatus === 'rejected') {
    return {
      tone: 'error',
      text: t('home.banners.kycRejected'),
      cta: t('home.banners.resendCta'),
      dismissible: false,
      target: '/(auth)/cadastro/dados',
    }
  }
  if (dismissed) return null
  if (kycStatus === 'pending') {
    return {
      tone: 'warning',
      text: t('home.banners.kycPending'),
      cta: t('home.banners.verifyCta'),
      dismissible: true,
      target: '/(auth)/cadastro/dados',
    }
  }
  if (kycStatus === 'submitted') {
    return {
      tone: 'warning',
      text: t('home.banners.kycSubmitted'),
      cta: t('home.banners.statusCta'),
      dismissible: true,
      target: '',
    }
  }
  if (accountStatus === 'evaluation') {
    return {
      tone: 'info',
      text: t('home.banners.evaluation'),
      cta: t('home.banners.learnMoreCta'),
      dismissible: true,
      target: '',
    }
  }
  return null
}

// ─── Componente principal ─────────────────────────────────────────────────────

const MOCK_SKIN = 'surf' as const  // Sprint 5: lounge.store retornará o skin ativo

export default function HomeScreen() {
  const { t } = useTranslation()
  const { user, kycStatus, accountStatus } = useAuthStore()
  const {
    balance,
    stale,
    status: balanceStatus,
    hidden,
    fetchBalance,
    toggleHidden,
    loadHiddenPreference,
  } = useBalanceStore()

  const [refreshing, setRefreshing]         = useState(false)
  const [dismissedBanner, setDismissedBanner] = useState(false)

  const skin = spaceSkins[MOCK_SKIN]

  // Carrega preferência de ocultar e saldo no mount
  useEffect(() => {
    loadHiddenPreference()
    fetchBalance()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh ao retornar de fluxo filho (spec HO-12)
  useFocusEffect(
    useCallback(() => {
      fetchBalance()
    }, []), // eslint-disable-line react-hooks/exhaustive-deps
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchBalance()
    setRefreshing(false)
  }

  const banner = resolveBanner(kycStatus, accountStatus, dismissedBanner, t)

  const handleAction = (action: string) => {
    switch (action) {
      case 'receber':    router.push('/(app)/receber' as never);    break
      case 'carregar':   router.push('/(app)/carregar' as never);   break
      case 'transferir': router.push('/(app)/transferir' as never); break
      case 'split':      router.push('/(app)/split' as never);      break
    }
  }

  const handleNav = (item: string) => {
    switch (item) {
      case 'perfil':    router.push('/(app)/perfil' as never);    break
      case 'achar':     router.push('/(app)/achar' as never);     break
      case 'lounge':    router.push('/(app)/lounge' as never);    break
      case 'atividade': router.push('/(app)/atividade' as never); break
    }
  }

  const firstName = user?.name.split(' ')[0] ?? ''

  return (
    <View style={[styles.root, { backgroundColor: skin.bgDark }]}>

      {/* Marca d'água — logo Alber muito tênue ao centro */}
      <Image
        source={require('../../assets/icon.png')}
        style={[styles.watermark, { opacity: skin.wm }]}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no"
      />

      {/* Scroll + conteúdo */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="rgba(255,255,255,0.4)"
          />
        }
      >
        {/* Header home — shell fixa, nunca alterado pela skin */}
        <Header
          variant="home"
          userName={firstName}
          accentColor={skin.accent}
          hasNotification={kycStatus !== 'approved'}
          onBell={() => { /* Sprint 6: notificações */ }}
        />

        {/* Banner contextual por prioridade (máx 1 por vez) */}
        {banner != null && (
          <View style={styles.bannerWrap}>
            <HomeBanner
              banner={banner}
              onPress={() => {
                if (banner.target) router.push(banner.target as never)
              }}
              onDismiss={banner.dismissible ? () => setDismissedBanner(true) : undefined}
            />
          </View>
        )}

        {/* Bloco de saldo */}
        <BalanceBlock
          balance={balance}
          status={balanceStatus}
          hidden={hidden}
          onToggle={toggleHidden}
          onCarregarMais={() => handleAction('carregar')}
          onRetry={fetchBalance}
        />

        {/* Aviso de saldo desatualizado — Asaas indisponível momentaneamente */}
        {stale && balanceStatus === 'success' && (
          <View style={styles.staleWrap}>
            <Text style={styles.staleText}>{t('home.balance.stale')}</Text>
          </View>
        )}

        {/* Seção Lounge atual */}
        <Pressable
          onPress={() => handleNav('lounge')}
          style={styles.loungeSection}
          accessibilityRole="button"
          accessibilityLabel={skin.name}
        >
          <Eyebrow>{t('home.lounge.label')}</Eyebrow>
          <View style={styles.loungeNameRow}>
            {MOCK_SKIN !== 'none' && (
              <View style={[styles.loungeDot, { backgroundColor: skin.accent }]} />
            )}
            <Text style={styles.loungeName}>{skin.name}</Text>
            <Text style={styles.loungeChevron}>›</Text>
          </View>
          {skin.role != null && (
            <Eyebrow color="rgba(255,255,255,0.32)">{skin.role}</Eyebrow>
          )}
        </Pressable>

        {/* Action rows */}
        <View style={styles.actionsWrap}>
          <ActionRow
            icon={<ReceberIcon />}
            label={t('home.actions.receber')}
            onPress={() => handleAction('receber')}
          />
          <ActionRow
            icon={<CarregarIcon />}
            label={t('home.actions.carregar')}
            sublabel={kycStatus !== 'approved' ? t('home.actions.carregarKyc') : undefined}
            onPress={() => handleAction('carregar')}
          />
          <ActionRow
            icon={<TransferirIcon />}
            label={t('home.actions.transferir')}
            onPress={() => handleAction('transferir')}
          />
          <ActionRow
            icon={<SplitIcon />}
            label={t('home.actions.split')}
            onPress={() => handleAction('split')}
          />
        </View>

        {/* Espaço para o BottomNav não sobrepor conteúdo */}
        <View style={{ height: spacing.bottomNavHeight + spacing.lg }} />
      </ScrollView>

      {/* Bottom navigation — shell fixa */}
      <BottomNav active="home" onNavigate={item => handleNav(item)} />
    </View>
  )
}

// ─── HomeBanner ───────────────────────────────────────────────────────────────

interface HomeBannerProps {
  banner: BannerData
  onPress: () => void
  onDismiss?: () => void
}

function HomeBanner({ banner, onPress, onDismiss }: HomeBannerProps) {
  const tones = {
    warning: { color: colors.warning[500],  bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.22)' },
    error:   { color: colors.state.error,   bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.22)' },
    info:    { color: 'rgba(255,255,255,0.65)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)' },
  }
  const t = tones[banner.tone]

  return (
    <Pressable
      onPress={onPress}
      style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }]}
      accessibilityRole="button"
    >
      <View style={[styles.bannerDot, { backgroundColor: t.color }]} />
      <Text style={[styles.bannerText, { color: t.color }]}>{banner.text}</Text>
      <Text style={[styles.bannerCta, { color: t.color }]}>{banner.cta}</Text>
      {onDismiss != null && (
        <Pressable onPress={onDismiss} hitSlop={8} style={styles.bannerClose}>
          <Text style={[styles.bannerCloseText, { color: t.color }]}>✕</Text>
        </Pressable>
      )}
    </Pressable>
  )
}

// ─── ActionRow ────────────────────────────────────────────────────────────────

interface ActionRowProps {
  icon: React.ReactNode
  label: string
  sublabel?: string
  onPress: () => void
  disabled?: boolean
}

function ActionRow({ icon, label, sublabel, onPress, disabled }: ActionRowProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.actionRow, disabled && styles.actionRowDisabled, pressed && styles.actionRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <View style={styles.actionLabel}>
        <Text style={styles.actionText}>{label}</Text>
        {sublabel != null && <Text style={styles.actionSublabel}>{sublabel}</Text>}
      </View>
      <Text style={styles.actionChevron}>›</Text>
    </Pressable>
  )
}

// ─── Action icons (puro View) ─────────────────────────────────────────────────

const AI = 'rgba(255,255,255,0.8)'
const AW = 1.5

function ReceberIcon() {
  // Seta para baixo: linha vertical + V-chevron
  return (
    <View style={aiv.root}>
      <View style={[aiv.line, { top: 2, left: 9, height: 10 }]} />
      <View style={[aiv.arm, { bottom: 2, left: 4,  transform: [{ rotate: '40deg'  }] }]} />
      <View style={[aiv.arm, { bottom: 2, right: 4, transform: [{ rotate: '-40deg' }] }]} />
    </View>
  )
}

function CarregarIcon() {
  // Seta para cima: ^-chevron + linha vertical
  return (
    <View style={aiv.root}>
      <View style={[aiv.arm, { top: 2, left: 4,  transform: [{ rotate: '-40deg' }] }]} />
      <View style={[aiv.arm, { top: 2, right: 4, transform: [{ rotate: '40deg'  }] }]} />
      <View style={[aiv.line, { bottom: 2, left: 9, height: 10 }]} />
    </View>
  )
}

function TransferirIcon() {
  // Seta para a direita: linha horizontal + >-chevron
  return (
    <View style={aiv.root}>
      <View style={[aiv.hline, { top: 9, left: 2, width: 11 }]} />
      <View style={[aiv.arm, { top: 4,  right: 2, transform: [{ rotate: '40deg'  }] }]} />
      <View style={[aiv.arm, { bottom: 4, right: 2, transform: [{ rotate: '-40deg' }] }]} />
    </View>
  )
}

function SplitIcon() {
  // Barra vertical esquerda + duas setas direita (cima e baixo)
  return (
    <View style={aiv.root}>
      <View style={[aiv.line, { top: 2, left: 2, height: 16 }]} />
      <View style={[aiv.hline, { top: 4, left: 4, width: 8 }]} />
      <View style={[aiv.hline, { bottom: 4, left: 4, width: 8 }]} />
      <View style={[aiv.arm, { top: 2,    right: 2, transform: [{ rotate: '40deg'  }] }]} />
      <View style={[aiv.arm, { bottom: 2, right: 2, transform: [{ rotate: '-40deg' }] }]} />
    </View>
  )
}

const aiv = StyleSheet.create({
  root:  { width: 20, height: 20 },
  line:  { position: 'absolute', width: AW, backgroundColor: AI, borderRadius: 1 },
  hline: { position: 'absolute', height: AW, backgroundColor: AI, borderRadius: 1 },
  arm:   { position: 'absolute', width: 7, height: AW, backgroundColor: AI, borderRadius: 1 },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  watermark: {
    position: 'absolute',
    top: '35%',
    alignSelf: 'center',
    width: 280,
    height: 280,
    pointerEvents: 'none',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },

  // Banner
  bannerWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: 14,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    paddingHorizontal: 14,
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
  },
  bannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.fontFamily.primary,
  },
  bannerCta: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.22,
    fontFamily: typography.fontFamily.primary,
  },
  bannerClose: {
    paddingLeft: 6,
  },
  bannerCloseText: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
  },

  // Lounge
  loungeSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: 40,
    paddingBottom: spacing.lg,
    flex: 1,
  },
  loungeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  loungeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  loungeName: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.white[100],
    letterSpacing: -0.52,
    fontFamily: typography.fontFamily.primary,
    flex: 1,
  },
  loungeChevron: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: typography.fontFamily.primary,
  },

  // Stale balance
  staleWrap: {
    marginHorizontal: spacing.lg,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  staleText: {
    fontSize: 11,
    color: colors.warning[500],
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
  },

  // Actions
  actionsWrap: {
    paddingHorizontal: spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  actionRowDisabled: {
    opacity: 0.4,
  },
  actionRowPressed: {
    opacity: 0.55,
  },
  actionIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    flex: 1,
  },
  actionText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '400',
    fontFamily: typography.fontFamily.primary,
  },
  actionSublabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
    fontFamily: typography.fontFamily.primary,
  },
  actionChevron: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.2)',
    fontFamily: typography.fontFamily.primary,
  },
})
