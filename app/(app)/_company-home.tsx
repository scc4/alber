// Plano CNPJ (velvet-puzzling-sedgewick)
// Home de uma empresa — renderizada por index.tsx quando o contexto ativo é
// 'company'. Prefixo "_" impede o Expo Router de tratar como rota própria.
// Mesma estrutura visual da Home pessoal (Header, banner, saldo, ações) —
// sem Lounge/Split (não existem pra empresa). Gestão (KYC, operadores,
// chave Pix, abandonar) fica em app/(app)/empresas/index.tsx.

import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Header } from '../../components/core/Header'
import { BalanceBlock } from '../../components/financial/BalanceBlock'
import { ActionRow, ReceberIcon, CarregarIcon, TransferirIcon } from '../../components/financial/ActionRow'
import { HomeBanner, BannerData } from '../../components/shared/HomeBanner'
import { useCompanyStore } from '../../store/company.store'
import { useNotificationsStore } from '../../store/notifications.store'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'

interface CompanyHomeScreenProps {
  companyId: string
  companyName: string
}

function resolveCompanyBanner(
  kycStatus: string,
  dismissed: boolean,
  t: (k: string) => string,
): BannerData | null {
  if (kycStatus === 'rejected') {
    return {
      tone: 'error',
      text: t('empresas.detalhe.kycRejectedBanner'),
      cta: t('empresas.detalhe.gerenciarCta'),
      dismissible: false,
      target: '/(app)/empresas',
    }
  }
  if (dismissed) return null
  if (kycStatus === 'pending' || kycStatus === 'submitted') {
    return {
      tone: 'warning',
      text: t('empresas.detalhe.kycPendingBanner'),
      cta: t('empresas.detalhe.gerenciarCta'),
      dismissible: true,
      target: '/(app)/empresas',
    }
  }
  return null
}

export function CompanyHomeScreen({ companyId, companyName }: CompanyHomeScreenProps) {
  const { t } = useTranslation()
  const unreadCount = useNotificationsStore(s => s.unreadCount)

  const companies     = useCompanyStore(s => s.companies)
  const activeBalance = useCompanyStore(s => s.activeBalance)
  const balanceStatus = useCompanyStore(s => s.balanceStatus)
  const fetchBalance  = useCompanyStore(s => s.fetchBalance)

  const company  = companies.find(c => c.id === companyId)
  const isMaster = company?.role === 'master'
  const canReceber    = isMaster || company?.permissions?.receber === true
  const canCarregar   = isMaster || company?.permissions?.carregar === true
  const canTransferir = isMaster || company?.permissions?.transferir === true

  const [hidden, setHidden]         = useState(false)
  const [dismissedBanner, setDismissedBanner] = useState(false)

  useEffect(() => { fetchBalance(companyId) }, [companyId])

  const banner = isMaster ? resolveCompanyBanner(company?.kyc_status ?? '', dismissedBanner, t) : null

  const handleAction = (action: 'receber' | 'carregar' | 'transferir') => {
    router.push(`/(app)/${action}` as never)
  }

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Header
          variant="home"
          userName={companyName}
          greetingOverride={isMaster ? t('empresas.roleMaster') : t('empresas.roleOperator')}
          hasNotification={unreadCount > 0}
          onLogoPress={() => router.replace('/(app)/')}
          onBell={() => router.push('/(app)/notificacoes' as never)}
          onAvatarPress={() => router.push('/(app)/perfil' as never)}
        />

        {banner != null && (
          <HomeBanner
            banner={banner}
            onPress={() => { if (banner.target) router.push(banner.target as never) }}
            onDismiss={banner.dismissible ? () => setDismissedBanner(true) : undefined}
          />
        )}

        <BalanceBlock
          balance={activeBalance.available}
          status={balanceStatus}
          hidden={hidden}
          onToggle={() => setHidden(h => !h)}
          onCarregarMais={() => handleAction('carregar')}
          onRetry={() => fetchBalance(companyId)}
        />

        <View style={styles.actionsWrap}>
          <ActionRow
            icon={<ReceberIcon />}
            label={t('home.actions.receber')}
            sublabel={!canReceber ? t('empresas.detalhe.permissionRequired') : undefined}
            disabled={!canReceber}
            onPress={() => handleAction('receber')}
          />
          <ActionRow
            icon={<CarregarIcon />}
            label={t('home.actions.carregar')}
            sublabel={!canCarregar ? t('empresas.detalhe.permissionRequired') : undefined}
            disabled={!canCarregar}
            onPress={() => handleAction('carregar')}
          />
          <ActionRow
            icon={<TransferirIcon />}
            label={t('home.actions.transferir')}
            sublabel={!canTransferir ? t('empresas.detalhe.permissionRequired') : undefined}
            disabled={!canTransferir}
            onPress={() => handleAction('transferir')}
          />
        </View>

        <View style={{ height: spacing.bottomNavHeight + spacing.lg }} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  actionsWrap: { paddingHorizontal: spacing.lg, marginTop: 40 },
})
