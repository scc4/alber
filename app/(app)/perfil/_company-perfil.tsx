// Perfil da empresa — renderizada por perfil/index.tsx quando o contexto
// ativo é 'company'. Prefixo "_" impede o Expo Router de tratar como rota
// própria (mesmo padrão de app/(app)/_company-home.tsx). Mesma estrutura
// visual do perfil pessoal (hero + Section + ActionRow, importados de
// ./_shared) — com dados da empresa no lugar dos dados pessoais.

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ActionRow, Section, UserAvatar, VerifiedBadge, styles } from './_shared'
import { AccountSwitcherSheet } from '../../../components/core/AccountSwitcherSheet'
import { WebViewModal } from '../../../components/shared/WebViewModal'
import { useAccountSwitcher } from '../../../hooks/useAccountSwitcher'
import { useAuthStore } from '../../../store/auth.store'
import { useCompanyStore } from '../../../store/company.store'
import { useActiveContextStore } from '../../../store/active-context.store'
import { kycInfo } from '../../../utils/kyc'
import { colors } from '../../../tokens/colors'

interface CompanyPerfilScreenProps {
  companyId: string
  companyName: string
}

export function CompanyPerfilScreen({ companyId, companyName }: CompanyPerfilScreenProps) {
  const { t }       = useTranslation()
  const switcher     = useAccountSwitcher()
  const logout       = useAuthStore(s => s.logout)
  const setContext   = useActiveContextStore(s => s.setContext)

  const companies      = useCompanyStore(s => s.companies)
  const fetchCompanies = useCompanyStore(s => s.fetchCompanies)
  const abandonCompany = useCompanyStore(s => s.abandonCompany)

  const [kycWebViewVisible, setKycWebViewVisible] = useState(false)

  useEffect(() => { fetchCompanies() }, [])

  const company  = companies.find(c => c.id === companyId)
  const isMaster = company?.role === 'master'
  const canManageOperators = isMaster || company?.permissions?.gerenciar_operadores === true
  const { label: kycLabel, color: kycColor } = kycInfo(company?.kyc_status ?? 'pending', t)

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
  }, [logout, t])

  const handleAbandon = useCallback(() => {
    Alert.alert(
      t('empresas.detalhe.abandonConfirmTitle'),
      t('empresas.detalhe.abandonConfirmBody'),
      [
        { text: t('empresas.detalhe.abandonCancel'), style: 'cancel' },
        {
          text: t('empresas.detalhe.abandonConfirmCta'),
          style: 'destructive',
          onPress: async () => {
            try {
              await abandonCompany(companyId)
              await setContext({ type: 'personal' })
              router.replace('/(app)/')
            } catch {
              Alert.alert(t('empresas.detalhe.abandonErrorTitle'), t('empresas.detalhe.abandonErrorGeneric'))
            }
          },
        },
      ],
    )
  }, [abandonCompany, companyId, setContext, t])

  if (!company) return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('perfil.title')}</Text>
      </View>
      <View style={styles.hero}>
        <UserAvatar name={companyName} />
        <View style={styles.heroMeta}>
          <Text style={styles.heroName}>{companyName}</Text>
        </View>
      </View>
      <ActivityIndicator color="rgba(255,255,255,0.4)" style={{ flex: 1 }} />
    </SafeAreaView>
  )

  const displayName = company.trading_name || company.company_name

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

        {/* Empresa hero */}
        <View style={styles.hero}>
          <UserAvatar name={displayName} />
          <View style={styles.heroMeta}>
            <Text style={styles.heroName}>{displayName}</Text>
            <View style={styles.heroHandleRow}>
              <Text style={styles.heroHandle}>@{company.handle}</Text>
              {company.kyc_status === 'approved' && <VerifiedBadge />}
            </View>
            <Text style={styles.heroSince}>
              {isMaster ? t('empresas.roleMaster') : t('empresas.roleOperator')}
            </Text>
          </View>
        </View>

        <AccountSwitcherSheet
          visible={switcher.visible}
          onClose={switcher.close}
          hasPersonalWallet={switcher.hasPersonalWallet}
          companies={switcher.companies}
          current={switcher.context}
          onSelect={switcher.select}
          onManageCompanies={switcher.openManage}
        />

        <WebViewModal
          visible={kycWebViewVisible}
          url={company.onboarding_url ?? ''}
          title={t('empresas.detalhe.kycWebViewTitle')}
          onClose={() => { setKycWebViewVisible(false); fetchCompanies() }}
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
            label={t('empresas.detalhe.dadosCta')}
            sublabel={company.cnpj_masked ?? t('empresas.dados.cnpjPlaceholder')}
            onPress={() => router.push(`/(app)/empresas/${companyId}/dados`)}
          />
          {isMaster && (
            <ActionRow
              label={t('empresas.detalhe.pixKeyCta')}
              onPress={() => router.push(`/(app)/empresas/${companyId}/pix`)}
            />
          )}
        </Section>

        {/* OPERADORES */}
        {canManageOperators && (
          <Section title={t('empresas.operadores.title')}>
            <ActionRow
              label={t('empresas.detalhe.operadoresCta')}
              onPress={() => router.push(`/(app)/empresas/${companyId}/operadores`)}
            />
          </Section>
        )}

        {/* VERIFICAÇÃO */}
        {isMaster && (
          <Section title={t('perfil.sectionVerificacao')}>
            <ActionRow
              label={t('perfil.rowKyc')}
              sublabel={kycLabel}
              accentSublabel
              accentColor={kycColor}
              onPress={() => { if (company.onboarding_url) setKycWebViewVisible(true) }}
            />
          </Section>
        )}

        {/* GESTÃO */}
        {isMaster && company.kyc_status !== 'approved' && (
          <Section title={t('empresas.perfil.sectionGestao')}>
            <ActionRow
              label={t('empresas.detalhe.abandonCta')}
              sublabel={t('perfil.rowExcluirContaSublabel')}
              accentSublabel
              accentColor={colors.state.error}
              onPress={handleAbandon}
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
