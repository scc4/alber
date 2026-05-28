import React, { useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/auth.store'
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

function ActionRow({ label, sublabel, accentSublabel, accentColor, onPress }: ActionRowProps) {
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

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function UserAvatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarInitial}>{name[0].toUpperCase()}</Text>
    </View>
  )
}

// ── Verified badge ────────────────────────────────────────────────────────────

function VerifiedBadge() {
  return (
    <View style={styles.verifiedBadge}>
      <Text style={styles.verifiedCheck}>✓</Text>
    </View>
  )
}

// ── KYC sublabel + accent ─────────────────────────────────────────────────────

function kycInfo(status: string, t: (k: string) => string): { label: string; color: string } {
  switch (status) {
    case 'approved':  return { label: t('perfil.kycApproved'),  color: colors.state.success }
    case 'submitted': return { label: t('perfil.kycSubmitted'), color: colors.warning[500] }
    case 'rejected':  return { label: t('perfil.kycRejected'),  color: colors.state.error }
    default:          return { label: t('perfil.kycPending'),   color: colors.warning[500] }
  }
}

// ── Screen ────────────────────────────────────────────────────────────────────

const MOCK_MEMBER_SINCE = 'abr/2026'

export default function PerfilScreen() {
  const { t }          = useTranslation()
  const router         = useRouter()
  const user           = useAuthStore(s => s.user)
  const kycStatus      = useAuthStore(s => s.kycStatus)
  const logout         = useAuthStore(s => s.logout)

  const isLoadingSession = useAuthStore(s => s.isLoadingSession)
  const { label: kycLabel, color: kycColor } = kycInfo(kycStatus, t)

  useEffect(() => {
    if (!isLoadingSession && !user) {
      router.back()
    }
  }, [isLoadingSession, user, router])

  const handleLogout = useCallback(() => {
    Alert.alert(
      t('perfil.logoutConfirmTitle'),
      t('perfil.logoutConfirmBody'),
      [
        { text: t('perfil.logoutCancel'), style: 'cancel' },
        {
          text: t('perfil.logoutConfirmCta'),
          style: 'destructive',
          onPress: () => {
            logout()
            router.replace('/(auth)/welcome')
          },
        },
      ]
    )
  }, [logout, router, t])

  if (!user) return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ActivityIndicator color="rgba(255,255,255,0.4)" style={{ flex: 1 }} />
    </SafeAreaView>
  )

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('perfil.title')}</Text>
        </View>

        {/* User hero */}
        <View style={styles.hero}>
          <UserAvatar name={user.name} />
          <View style={styles.heroMeta}>
            <Text style={styles.heroName}>{user.name}</Text>
            <View style={styles.heroHandleRow}>
              <Text style={styles.heroHandle}>{user.handle}</Text>
              {kycStatus === 'approved' && <VerifiedBadge />}
            </View>
            <Text style={styles.heroSince}>
              {t('perfil.memberSince', { date: MOCK_MEMBER_SINCE })}
            </Text>
          </View>
        </View>

        {/* CONTA */}
        <Section title={t('perfil.sectionConta')}>
          <ActionRow
            label={t('perfil.rowDados')}
            sublabel={user.cpfMasked}
            onPress={() => router.push('/(app)/perfil/dados')}
          />
          <ActionRow
            label={t('perfil.rowHandle')}
            sublabel={user.handle}
            onPress={() => router.push('/(app)/perfil/handle')}
          />
          <ActionRow
            label={t('perfil.rowPin')}
            sublabel={t('perfil.pinSublabel')}
            onPress={() => router.push('/(app)/perfil/seguranca')}
          />
          <ActionRow
            label={t('perfil.rowPix')}
            sublabel={user.pixKey}
            onPress={() => router.push('/(app)/perfil/seguranca')}
          />
          <ActionRow
            label={t('perfil.rowSecurity')}
            sublabel={t('perfil.securityQtd')}
            onPress={() => router.push('/(app)/perfil/seguranca')}
          />
        </Section>

        {/* VERIFICAÇÃO */}
        <Section title={t('perfil.sectionVerificacao')}>
          <ActionRow
            label={t('perfil.rowKyc')}
            sublabel={kycLabel}
            accentSublabel
            accentColor={kycColor}
            onPress={() => router.push('/(app)/perfil/kyc')}
          />
        </Section>

        {/* PREFERÊNCIAS */}
        <Section title={t('perfil.sectionPreferencias')}>
          <ActionRow
            label={t('perfil.rowNotificacoes')}
            sublabel={t('perfil.notifSublabel')}
            onPress={() => router.push('/(app)/perfil/notificacoes')}
          />
        </Section>

        {/* SUPORTE FINANCEIRO */}
        <Section title={t('perfil.sectionSuporteFinanceiro')}>
          <Text style={styles.suporteIntro}>{t('perfil.suporteIntro')}</Text>
          <ActionRow
            label={t('perfil.suporteTelefoneLabel')}
            sublabel={t('perfil.suporteTelefone')}
            onPress={() => Linking.openURL('tel:08000090037')}
          />
          <ActionRow
            label={t('perfil.suporteEmailLabel')}
            sublabel={t('perfil.suporteEmail')}
            onPress={() => Linking.openURL('mailto:contato@asaas.com.br')}
          />
        </Section>

        {/* SESSÃO */}
        <View style={styles.sessionSection}>
          <Text style={styles.eyebrow}>{t('perfil.sectionSessao')}</Text>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.75}>
            <Text style={styles.logoutText}>{t('perfil.logout')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const surf = spaceSkins.surf

const styles = StyleSheet.create({
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
