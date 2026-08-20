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
import { useCompanyStore } from '../../../store/company.store'
import { createPixKey } from '../../../services/financial.service'
import { formatDate } from '../../../utils/format'
import { kycInfo } from '../../../utils/kyc'
import { useAccountSwitcher } from '../../../hooks/useAccountSwitcher'
import { AccountSwitcherSheet } from '../../../components/core/AccountSwitcherSheet'
import { WebViewModal } from '../../../components/shared/WebViewModal'
import { colors, spaceSkins } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

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

function ProfileAvatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarInitial}>{name[0]?.toUpperCase() ?? '?'}</Text>
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

// ── PixKeyCard (só carteira pessoal) ────────────────────────────────────────────

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
//
// Uma tela só de Perfil pra pessoal e empresa — o que muda por contexto ativo
// é de onde vêm os dados e quais linhas aparecem, não a tela em si. Linhas
// sem equivalente na empresa (PIN, Perguntas de segurança, Notificações,
// Excluir conta) somem no contexto empresa; "Trocar de conta" e "Operadores"
// só existem por causa da empresa mas aparecem sempre que fizer sentido.

export default function PerfilScreen() {
  const { t }      = useTranslation()
  const router     = useRouter()
  const switcher   = useAccountSwitcher()

  const activeContext = useActiveContextStore(s => s.context)
  const isCompany      = activeContext.type === 'company'

  // ── Pessoal ───────────────────────────────────────────────────────────────
  const user              = useAuthStore(s => s.user)
  const token              = useAuthStore(s => s.token)
  const personalKycStatus = useAuthStore(s => s.kycStatus)
  const logout             = useAuthStore(s => s.logout)
  const isLoadingSession  = useAuthStore(s => s.isLoadingSession)

  const [memberSince, setMemberSince] = useState('')
  const [hasPixKey,   setHasPixKey]   = useState<boolean | null>(null)
  const [pixKeySuccessMsg, setPixKeySuccessMsg] = useState('')

  // ── Empresa ───────────────────────────────────────────────────────────────
  const companies      = useCompanyStore(s => s.companies)
  const fetchCompanies = useCompanyStore(s => s.fetchCompanies)
  const [kycWebViewVisible, setKycWebViewVisible] = useState(false)

  const company = isCompany
    ? companies.find(c => c.id === activeContext.companyId)
    : null
  const isMaster           = company?.role === 'master'
  const canManageOperators = isMaster || company?.permissions?.gerenciar_operadores === true

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

  useEffect(() => {
    if (isCompany) fetchCompanies()
  }, [isCompany]) // eslint-disable-line react-hooks/exhaustive-deps

  const showPixKeyCard = !isCompany && personalKycStatus === 'approved' && hasPixKey === false

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

  const loading = isCompany ? !company : !user
  if (loading) return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ActivityIndicator color="rgba(255,255,255,0.4)" style={{ flex: 1 }} />
    </SafeAreaView>
  )

  const displayName   = isCompany ? (company!.trading_name || company!.company_name) : user!.name
  const displayHandle = isCompany ? `@${company!.handle}` : user!.handle
  const verified       = isCompany ? company!.kyc_status === 'approved' : personalKycStatus === 'approved'
  const effectiveKyc    = isCompany ? company!.kyc_status : personalKycStatus
  const { label: kycLabel, color: kycColor } = kycInfo(effectiveKyc, t)

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

        {/* Hero */}
        <View style={styles.hero}>
          <ProfileAvatar name={displayName} />
          <View style={styles.heroMeta}>
            <Text style={styles.heroName}>{displayName}</Text>
            <View style={styles.heroHandleRow}>
              <Text style={styles.heroHandle}>{displayHandle}</Text>
              {verified && <VerifiedBadge />}
            </View>
            {isCompany ? (
              <Text style={styles.heroSince}>
                {isMaster ? t('empresas.roleMaster') : t('empresas.roleOperator')}
              </Text>
            ) : memberSince ? (
              <Text style={styles.heroSince}>
                {t('perfil.memberSince', { date: formatDate(memberSince) })}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Chave Pix ausente — card de geração (só carteira pessoal) */}
        {showPixKeyCard && (
          <PixKeyCard
            onGenerated={() => {
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
        />

        {isCompany && (
          <WebViewModal
            visible={kycWebViewVisible}
            url={company?.onboarding_url ?? ''}
            title={t('empresas.detalhe.kycWebViewTitle')}
            onClose={() => { setKycWebViewVisible(false); fetchCompanies() }}
          />
        )}

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
            sublabel={isCompany ? (company!.cnpj_masked ?? t('empresas.dados.cnpjPlaceholder')) : user!.cpfMasked}
            onPress={() => router.push('/(app)/perfil/dados')}
          />
          {!isCompany && (
            <ActionRow
              label={t('perfil.rowHandle')}
              sublabel={user!.handle}
              onPress={() => router.push('/(app)/perfil/handle')}
            />
          )}
          {!isCompany && (
            <ActionRow
              label={t('perfil.rowPin')}
              sublabel={t('perfil.pinSublabel')}
              onPress={() => router.push('/(app)/perfil/seguranca')}
            />
          )}
          {(!isCompany || isMaster) && (
            <ActionRow
              label={t('perfil.rowPix')}
              sublabel={isCompany ? undefined : user!.pixKey}
              onPress={() => isCompany
                ? router.push(`/(app)/empresas/${company!.id}/pix`)
                : router.push('/(app)/perfil/seguranca')}
            />
          )}
          {!isCompany && (
            <ActionRow
              label={t('perfil.rowSecurity')}
              sublabel={t('perfil.securityQtd')}
              onPress={() => router.push('/(app)/perfil/seguranca')}
            />
          )}
          {isCompany && canManageOperators && (
            <ActionRow
              label={t('empresas.detalhe.operadoresCta')}
              onPress={() => router.push(`/(app)/empresas/${company!.id}/operadores`)}
            />
          )}
        </Section>

        {/* VERIFICAÇÃO */}
        <Section title={t('perfil.sectionVerificacao')}>
          <ActionRow
            label={t('perfil.rowKyc')}
            sublabel={kycLabel}
            accentSublabel
            accentColor={kycColor}
            onPress={() => {
              if (!isCompany) { router.push('/(app)/perfil/kyc'); return }
              if (isMaster && company?.onboarding_url) setKycWebViewVisible(true)
            }}
          />
        </Section>

        {/* PREFERÊNCIAS (só carteira pessoal) */}
        {!isCompany && (
          <Section title={t('perfil.sectionPreferencias')}>
            <ActionRow
              label={t('perfil.rowNotificacoes')}
              sublabel={t('perfil.notifSublabel')}
              onPress={() => router.push('/(app)/perfil/notificacoes')}
            />
          </Section>
        )}

        {/* CONTA E PRIVACIDADE (só carteira pessoal) */}
        {!isCompany && (
          <Section title={t('perfil.sectionContaPrivacidade')}>
            <ActionRow
              label={t('perfil.rowExcluirConta')}
              sublabel={t('perfil.rowExcluirContaSublabel')}
              accentSublabel
              accentColor={colors.state.error}
              onPress={() => router.push('/(app)/perfil/excluir-conta')}
            />
          </Section>
        )}

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
  pixSuccessWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: spacing.radius.md,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(34,197,94,0.25)',
  },
  pixSuccessText: {
    fontSize: 12,
    color: colors.state.success,
    fontFamily: typography.fontFamily.primary,
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
