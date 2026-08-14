// Plano CNPJ (velvet-puzzling-sedgewick)
// Home de uma empresa — renderizada por index.tsx quando o contexto ativo é
// 'company'. Prefixo "_" impede o Expo Router de tratar como rota própria.

import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Header } from '../../components/core/Header'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { Field } from '../../components/core/Field'
import { QRCodeDisplay } from '../../components/financial/QRCodeDisplay'
import { AccountSwitcherSheet } from '../../components/core/AccountSwitcherSheet'
import { WebViewModal } from '../../components/shared/WebViewModal'
import { useAuthStore } from '../../store/auth.store'
import { useCompanyStore } from '../../store/company.store'
import { useActiveContextStore } from '../../store/active-context.store'
import { useNotificationsStore } from '../../store/notifications.store'
import { useAccountSwitcher } from '../../hooks/useAccountSwitcher'
import * as financialService from '../../services/financial.service'
import { BffError } from '../../services/auth.service'
import { formatAlbers } from '../../utils/format'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

interface CompanyHomeScreenProps {
  companyId: string
  companyName: string
}

export function CompanyHomeScreen({ companyId, companyName }: CompanyHomeScreenProps) {
  const { t }   = useTranslation()
  const switcher = useAccountSwitcher()
  const unreadCount = useNotificationsStore(s => s.unreadCount)
  const token = useAuthStore(s => s.token)

  const companies      = useCompanyStore(s => s.companies)
  const activeBalance  = useCompanyStore(s => s.activeBalance)
  const balanceStatus  = useCompanyStore(s => s.balanceStatus)
  const fetchBalance   = useCompanyStore(s => s.fetchBalance)
  const abandonCompany = useCompanyStore(s => s.abandonCompany)
  const setContext     = useActiveContextStore(s => s.setContext)

  // Dados de papel/permissão vêm da lista já carregada pelo switcher/company-list
  const company = companies.find(c => c.id === companyId)
  const isMaster = company?.role === 'master'
  const canCarregar = isMaster || company?.permissions?.carregar === true

  useEffect(() => { fetchBalance(companyId) }, [companyId])

  const [showCarregar, setShowCarregar] = useState(false)
  const [amount, setAmount]             = useState('')
  const [loadingQr, setLoadingQr]       = useState(false)
  const [qr, setQr] = useState<financialService.CarregarResponse | null>(null)
  const [kycWebViewVisible, setKycWebViewVisible] = useState(false)

  // Banner de KYC — só o master interage (verificar/cancelar são ações sobre
  // a identidade legal da empresa, não delegáveis a operador mesmo com
  // permissão de gerenciar_operadores). Plano velvet-puzzling-sedgewick.
  const handleKycVerify = useCallback(() => {
    if (company?.onboarding_url) setKycWebViewVisible(true)
  }, [company?.onboarding_url])

  const handleKycWebViewClose = useCallback(() => {
    setKycWebViewVisible(false)
    useCompanyStore.getState().fetchCompanies()
  }, [])

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
              setContext({ type: 'personal' })
              router.replace('/(app)/')
            } catch {
              Alert.alert(t('empresas.detalhe.abandonErrorTitle'), t('empresas.detalhe.abandonErrorGeneric'))
            }
          },
        },
      ],
    )
  }, [abandonCompany, companyId, setContext, t])

  const handleGerarQr = useCallback(async () => {
    const numeric = parseFloat(amount.replace(',', '.'))
    if (!token || !numeric || numeric <= 0) return
    setLoadingQr(true)
    try {
      const res = await financialService.carregar(token, numeric, companyId)
      setQr(res)
    } catch (e) {
      const isBff = e instanceof BffError
      Alert.alert(t('empresas.detalhe.carregarErrorTitle'), isBff ? e.message : t('empresas.detalhe.carregarErrorGeneric'))
    } finally {
      setLoadingQr(false)
    }
  }, [amount, companyId, t])

  return (
    <View style={styles.root}>
      <Header
        variant="home"
        userName={companyName}
        greetingOverride={isMaster ? t('empresas.roleMaster') : t('empresas.roleOperator')}
        hasNotification={unreadCount > 0}
        onBell={() => router.push('/(app)/notificacoes' as never)}
        onAvatarPress={() => router.push('/(app)/perfil' as never)}
        onSwitcherPress={switcher.canSwitch ? switcher.open : undefined}
      />

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
        url={company?.onboarding_url ?? ''}
        title={t('empresas.detalhe.kycWebViewTitle')}
        onClose={handleKycWebViewClose}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {isMaster && (company?.kyc_status === 'pending' || company?.kyc_status === 'rejected') && (
          <Pressable
            onPress={handleKycVerify}
            style={[styles.kycBanner, company.kyc_status === 'rejected' && styles.kycBannerError]}
          >
            <Text style={[styles.kycBannerText, company.kyc_status === 'rejected' && styles.kycBannerTextError]}>
              {company.kyc_status === 'rejected'
                ? t('empresas.detalhe.kycRejectedBanner')
                : t('empresas.detalhe.kycPendingBanner')}
            </Text>
            <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleAbandon() }} hitSlop={8}>
              <Text style={[styles.kycBannerCancel, company.kyc_status === 'rejected' && styles.kycBannerTextError]}>
                {t('empresas.detalhe.abandonCta')}
              </Text>
            </TouchableOpacity>
          </Pressable>
        )}

        <View style={styles.balanceBlock}>
          <Text style={styles.balanceLabel}>{t('empresas.detalhe.balanceLabel')}</Text>
          <Text style={styles.balanceValue}>
            {balanceStatus === 'loading' ? '—' : formatAlbers(activeBalance.available)}
          </Text>
          {activeBalance.stale && <Text style={styles.staleHint}>{t('empresas.detalhe.staleHint')}</Text>}
        </View>

        {!showCarregar && !qr && (
          <View style={styles.actionsRow}>
            {canCarregar && (
              <PrimaryButton label={t('empresas.detalhe.carregarCta')} onPress={() => setShowCarregar(true)} />
            )}
            <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/(app)/atividade')}>
              <Text style={styles.linkBtnText}>{t('empresas.detalhe.extratoCta')}</Text>
            </TouchableOpacity>
            {isMaster && (
              <TouchableOpacity style={styles.linkBtn} onPress={() => router.push(`/(app)/empresas/${companyId}/operadores`)}>
                <Text style={styles.linkBtnText}>{t('empresas.detalhe.operadoresCta')}</Text>
              </TouchableOpacity>
            )}
            {isMaster && (
              <TouchableOpacity style={styles.linkBtn} onPress={() => router.push(`/(app)/empresas/${companyId}/pix`)}>
                <Text style={styles.linkBtnText}>{t('empresas.detalhe.pixKeyCta')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {showCarregar && !qr && (
          <View style={styles.carregarBox}>
            <Field
              label={t('empresas.detalhe.amountLabel')}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              autoFocus
            />
            <PrimaryButton
              label={t('empresas.detalhe.gerarQrCta')}
              onPress={handleGerarQr}
              state={loadingQr ? 'loading' : 'default'}
            />
          </View>
        )}

        {qr && (
          <QRCodeDisplay
            cpfMasked={companyName}
            qrCodeImage={qr.qr_code_image}
            expiresAt={qr.expires_at}
            onGenerateNew={() => { setQr(null); setAmount('') }}
          />
        )}

        <View style={{ height: spacing.bottomNavHeight + spacing.lg }} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg },
  kycBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radius.md,
    backgroundColor: 'rgba(245,158,11,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.22)',
  },
  kycBannerError: {
    backgroundColor: 'rgba(239,68,68,0.07)',
    borderColor: 'rgba(239,68,68,0.22)',
  },
  kycBannerText: {
    flex: 1,
    fontSize: 12,
    color: colors.warning[500],
    fontFamily: typography.fontFamily.primary,
  },
  kycBannerTextError: {
    color: colors.state.error,
  },
  kycBannerCancel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warning[500],
    fontFamily: typography.fontFamily.primary,
    textDecorationLine: 'underline',
  },
  balanceBlock: { alignItems: 'center', gap: 4, marginBottom: spacing.md },
  balanceLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: typography.fontFamily.primary,
  },
  balanceValue: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  staleHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
  },
  actionsRow: { gap: spacing.sm },
  linkBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: spacing.radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  linkBtnText: {
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  carregarBox: { gap: spacing.sm },
})
