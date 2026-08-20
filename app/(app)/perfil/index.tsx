import React, { useCallback, useEffect, useState } from 'react'
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
import { useActiveContextStore } from '../../../store/active-context.store'
import { createPixKey } from '../../../services/financial.service'
import { formatDate } from '../../../utils/format'
import { kycInfo } from '../../../utils/kyc'
import { useAccountSwitcher } from '../../../hooks/useAccountSwitcher'
import { AccountSwitcherSheet } from '../../../components/core/AccountSwitcherSheet'
import { CompanyPerfilScreen } from './_company-perfil'
import { ActionRow, Section, UserAvatar, VerifiedBadge, styles } from './_shared'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// ── PixKeyCard ────────────────────────────────────────────────────────────────

interface PixKeyCardProps {
  onGenerated: (masked: string) => void
}

function PixKeyCard({ onGenerated }: PixKeyCardProps) {
  const { t }     = useTranslation()
  const token     = useAuthStore(s => s.token)
  const setUser   = useAuthStore(s => s.setUser)
  const user      = useAuthStore(s => s.user)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handleGenerate = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const res = await createPixKey(token)
      if (user) setUser({ ...user, hasPixKey: true, pixKey: res.pix_key_masked })
      onGenerated(res.pix_key_masked)
    } catch {
      setError(t('perfil.pixKeyError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={pixCardStyles.wrap}>
      <View style={pixCardStyles.dot} />
      <View style={pixCardStyles.body}>
        <Text style={pixCardStyles.title}>{t('perfil.pixKeyMissingTitle')}</Text>
        <Text style={pixCardStyles.body2}>{t('perfil.pixKeyMissingBody')}</Text>
        {error ? <Text style={pixCardStyles.error}>{error}</Text> : null}
      </View>
      <TouchableOpacity
        style={[pixCardStyles.btn, loading && pixCardStyles.btnLoading]}
        onPress={handleGenerate}
        disabled={loading}
        activeOpacity={0.75}
      >
        <Text style={pixCardStyles.btnText}>
          {loading ? t('perfil.pixKeyGenerating') : t('perfil.pixKeyGenerateCta')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const pixCardStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: 14,
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.3)',
    backgroundColor: 'rgba(245,158,11,0.06)',
    gap: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning[500],
    marginTop: 4,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: typography.weight.bold,
    color: colors.warning[500],
    fontFamily: typography.fontFamily.primary,
    marginBottom: 3,
  },
  body2: {
    fontSize: 12,
    color: colors.warning[500],
    fontFamily: typography.fontFamily.primary,
    lineHeight: 17,
  },
  error: {
    fontSize: 11,
    color: colors.state.error,
    fontFamily: typography.fontFamily.primary,
    marginTop: 4,
  },
  btn: {
    paddingVertical: 11,
    borderRadius: 9,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.4)',
    alignItems: 'center',
  },
  btnLoading: {
    opacity: 0.5,
  },
  btnText: {
    fontSize: 12,
    fontWeight: typography.weight.bold,
    color: colors.warning[500],
    letterSpacing: 0.5,
    fontFamily: typography.fontFamily.primary,
  },
})

// ── Screen ────────────────────────────────────────────────────────────────────

// Roteador por contexto ativo (pessoal ou empresa) — mesmo padrão de
// app/(app)/index.tsx. Home de empresa e Home pessoal levam pro mesmo
// /(app)/perfil; aqui decidimos qual tela renderizar.
export default function PerfilScreen() {
  const context = useActiveContextStore(s => s.context)
  if (context.type === 'company') {
    return <CompanyPerfilScreen companyId={context.companyId} companyName={context.companyName} />
  }
  return <PersonalPerfilScreen />
}

function PersonalPerfilScreen() {
  const { t }          = useTranslation()
  const router         = useRouter()
  const user           = useAuthStore(s => s.user)
  const token          = useAuthStore(s => s.token)
  const kycStatus      = useAuthStore(s => s.kycStatus)
  const logout         = useAuthStore(s => s.logout)
  const switcher       = useAccountSwitcher()

  const isLoadingSession = useAuthStore(s => s.isLoadingSession)
  const { label: kycLabel, color: kycColor } = kycInfo(kycStatus, t)

  const [memberSince, setMemberSince] = useState('')
  const [hasPixKey,   setHasPixKey]   = useState<boolean | null>(null)
  const [pixKeySuccessMsg, setPixKeySuccessMsg] = useState('')

  useEffect(() => {
    if (!isLoadingSession && !user) {
      router.back()
    }
  }, [isLoadingSession, user, router])

  useEffect(() => {
    if (!token) return
    fetch(`${BFF}/user-profile`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    })
      .then(r => r.json())
      .then(d => {
        if (d.member_since) setMemberSince(d.member_since)
        if (typeof d.has_pix_key === 'boolean') setHasPixKey(d.has_pix_key)
      })
      .catch(() => {})
  }, [token])

  const showPixKeyCard = kycStatus === 'approved' && hasPixKey === false

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
            {memberSince ? (
              <Text style={styles.heroSince}>
                {t('perfil.memberSince', { date: formatDate(memberSince) })}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Chave Pix ausente — card de geração */}
        {showPixKeyCard && (
          <PixKeyCard
            onGenerated={(masked) => {
              setHasPixKey(true)
              setPixKeySuccessMsg(t('perfil.pixKeySuccess'))
            }}
          />
        )}
        {pixKeySuccessMsg ? (
          <View style={styles.pixSuccessWrap}>
            <Text style={styles.pixSuccessText}>{pixKeySuccessMsg}</Text>
          </View>
        ) : null}

        <AccountSwitcherSheet
          visible={switcher.visible}
          onClose={switcher.close}
          hasPersonalWallet={switcher.hasPersonalWallet}
          companies={switcher.companies}
          current={switcher.context}
          onSelect={switcher.select}
          onManageCompanies={switcher.openManage}
        />

        {/* CONTA */}
        <Section title={t('perfil.sectionConta')}>
          {switcher.canSwitch && (
            <ActionRow
              label={t('accountSwitcher.title')}
              onPress={switcher.open}
            />
          )}
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

        {/* EMPRESAS (contas PJ) */}
        <Section title={t('perfil.sectionEmpresas')}>
          <ActionRow
            label={t('perfil.rowEmpresas')}
            sublabel={t('perfil.rowEmpresasSublabel')}
            onPress={() => router.push('/(app)/empresas')}
          />
        </Section>

        {/* CONTA E PRIVACIDADE */}
        <Section title={t('perfil.sectionContaPrivacidade')}>
          <ActionRow
            label={t('perfil.rowExcluirConta')}
            sublabel={t('perfil.rowExcluirContaSublabel')}
            accentSublabel
            accentColor={colors.state.error}
            onPress={() => router.push('/(app)/perfil/excluir-conta')}
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

