// Dados cadastrais da empresa — somente leitura, mesmo layout de
// app/(app)/perfil/dados.tsx (equivalente pessoal). Sem chamada de rede
// própria: lê da lista já carregada em company.store (fetchCompanies), com
// fallback defensivo pra quem chega aqui via deep link antes da Home buscar
// a lista.

import { useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useCompanyStore } from '../../../../store/company.store'
import { colors } from '../../../../tokens/colors'
import { typography } from '../../../../tokens/typography'
import { spacing } from '../../../../tokens/spacing'

interface DataRowProps { label: string; value: string }

function DataRow({ label, value }: DataRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

export default function EmpresaDadosScreen() {
  const { t }  = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()

  const companies       = useCompanyStore(s => s.companies)
  const companiesStatus = useCompanyStore(s => s.companiesStatus)
  const fetchCompanies  = useCompanyStore(s => s.fetchCompanies)

  const company = companies.find(c => c.id === id)

  useEffect(() => {
    if (!company) fetchCompanies()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loading = !company && companiesStatus === 'loading'
  const error   = !company && companiesStatus === 'error'

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('empresas.dados.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
          <Text style={styles.loadingText}>{t('perfil.dados.loading')}</Text>
        </View>
      )}

      {!loading && error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t('perfil.dados.errorLoad')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchCompanies} activeOpacity={0.75}>
            <Text style={styles.retryText}>{t('perfil.dados.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && company && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <DataRow label={t('empresas.dados.razaoSocial')}   value={company.company_name} />
          <DataRow label={t('empresas.dados.nomeFantasia')}  value={company.trading_name || '—'} />
          <DataRow label={t('empresas.dados.cnpj')}          value={company.cnpj_masked ?? t('empresas.dados.cnpjPlaceholder')} />
          <DataRow label={t('empresas.dados.handle')}        value={`@${company.handle}`} />

          <Text style={styles.readOnly}>{t('perfil.dados.readOnly')}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 32,
  },
  backIcon: {
    fontSize: 20,
    color: colors.white[100],
  },
  title: {
    ...typography.size.label,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.4)',
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.size.body,
    color: colors.state.error,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: spacing.radius.sm,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  retryText: {
    ...typography.size.caption,
    color: colors.white[100],
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  row: {
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowLabel: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 6,
  },
  rowValue: {
    ...typography.size.body,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
  },
  readOnly: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.3)',
    marginTop: spacing.xl,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
})
