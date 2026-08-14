// Plano CNPJ (velvet-puzzling-sedgewick)
// Lista/gestão das empresas onde o usuário é master ou operador ativo.
// Empresa só nasce no cadastro (auth-register) — não existe criação de
// empresa dentro do app, por decisão de produto. Trocar de contexto (entrar
// numa empresa) é feito pelo seletor de conta global (Header), não aqui.

import { useEffect } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { Header } from '../../../components/core/Header'
import { useAuthStore } from '../../../store/auth.store'
import { useCompanyStore } from '../../../store/company.store'
import { useActiveContextStore } from '../../../store/active-context.store'
import { colors } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

const STATUS_LABEL_KEY: Record<string, string> = {
  active:     'empresas.status.active',
  evaluation: 'empresas.status.evaluation',
  blocked:    'empresas.status.blocked',
}

export default function EmpresasIndexScreen() {
  const { t }      = useTranslation()
  const insets     = useSafeAreaInsets()
  const token      = useAuthStore(s => s.token)
  const companies       = useCompanyStore(s => s.companies)
  const companiesStatus = useCompanyStore(s => s.companiesStatus)
  const fetchCompanies  = useCompanyStore(s => s.fetchCompanies)
  const setContext      = useActiveContextStore(s => s.setContext)

  useEffect(() => {
    if (token) fetchCompanies()
  }, [token])

  return (
    <View style={styles.root}>
      <Header variant="title" title={t('empresas.title')} onBack={() => router.back()} />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom + 24, spacing.xl) }]}
        showsVerticalScrollIndicator={false}
      >
        {companiesStatus === 'loading' && companies.length === 0 && (
          <Text style={styles.helperText}>{t('empresas.loading')}</Text>
        )}

        {companiesStatus === 'success' && companies.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t('empresas.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>{t('empresas.emptyBody')}</Text>
          </View>
        )}

        {companies.map(c => (
          <TouchableOpacity
            key={c.id}
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => {
              setContext({ type: 'company', companyId: c.id, companyName: c.trading_name || c.company_name })
              router.replace('/(app)/')
            }}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardName} numberOfLines={1}>{c.trading_name || c.company_name}</Text>
              <View style={[styles.roleBadge, c.role === 'master' && styles.roleBadgeMaster]}>
                <Text style={styles.roleBadgeText}>
                  {c.role === 'master' ? t('empresas.roleMaster') : t('empresas.roleOperator')}
                </Text>
              </View>
            </View>
            <Text style={styles.cardStatus}>
              {c.kyc_status === 'rejected'
                ? t('empresas.status.rejected')
                : t(STATUS_LABEL_KEY[c.account_status] ?? 'empresas.status.evaluation')}
            </Text>
            {c.role === 'master' && (
              <TouchableOpacity
                style={styles.operatorsLink}
                onPress={(e) => { e.stopPropagation(); router.push(`/(app)/empresas/${c.id}/operadores`) }}
              >
                <Text style={styles.operatorsLinkText}>{t('empresas.detalhe.operadoresCta')}</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  flex: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  helperText: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  empty: {
    marginTop: spacing.xl,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    color: colors.white[100],
    fontSize: 16,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
  },
  emptyBody: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    textAlign: 'center',
    fontFamily: typography.fontFamily.primary,
    paddingHorizontal: spacing.lg,
  },
  card: {
    padding: spacing.lg,
    borderRadius: spacing.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  roleBadgeMaster: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  roleBadgeText: {
    fontSize: 10,
    color: colors.white[100],
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
  },
  cardStatus: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
  },
  operatorsLink: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  operatorsLinkText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    textDecorationLine: 'underline',
    fontFamily: typography.fontFamily.primary,
  },
})
