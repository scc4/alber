import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/auth.store'
import { useActiveContextStore } from '../../../store/active-context.store'
import { useCompanyStore } from '../../../store/company.store'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { AlertCard } from '../../../components/core/AlertCard'
import * as authService from '../../../services/auth.service'
import * as companyService from '../../../services/company.service'
import { validateCPF } from '../../../utils/cpf'
import { validateCNPJ, normalizeCNPJ } from '../../../utils/cnpj'
import { maskCNPJ } from '../../../utils/format'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

interface ProfileData {
  cpf_masked:     string | null
  email_masked:   string
  phone_masked:   string
  birth_masked:   string
  pix_key_masked: string
  pix_key_type:   string
}

// ── DataRow ───────────────────────────────────────────────────────────────────

interface DataRowProps { label: string; value: string }

function DataRow({ label, value }: DataRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function DadosScreen() {
  const { t }  = useTranslation()
  const user    = useAuthStore(s => s.user)
  const token   = useAuthStore(s => s.token)
  const setUser = useAuthStore(s => s.setUser)

  const activeContext = useActiveContextStore(s => s.context)
  const isCompany       = activeContext.type === 'company'
  const companies       = useCompanyStore(s => s.companies)
  const fetchCompanies  = useCompanyStore(s => s.fetchCompanies)
  const company = isCompany ? companies.find(c => c.id === activeContext.companyId) : null

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [data, setData]         = useState<ProfileData | null>(null)

  const [cpfConfirmValue, setCpfConfirmValue]         = useState('')
  const [cpfConfirmError, setCpfConfirmError]         = useState<string | null>(null)
  const [cpfConfirmSubmitting, setCpfConfirmSubmitting] = useState(false)

  const [cnpjConfirmValue, setCnpjConfirmValue]         = useState('')
  const [cnpjConfirmError, setCnpjConfirmError]         = useState<string | null>(null)
  const [cnpjConfirmSubmitting, setCnpjConfirmSubmitting] = useState(false)

  const load = async () => {
    if (isCompany) {
      setLoading(true)
      setError(false)
      try {
        await fetchCompanies()
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
      return
    }
    if (!token) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`${BFF}/user-profile`, {
        headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
      })
      if (!res.ok) { setError(true); return }
      const json = await res.json()
      setData(json)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token, isCompany]) // eslint-disable-line react-hooks/exhaustive-deps

  // Contas cadastradas antes de cpf_masked/cnpj_masked existirem não têm
  // esse campo salvo — só o hash é guardado, então pedimos pro próprio
  // usuário confirmar o CPF/CNPJ uma vez pra calcular e persistir a máscara.
  const handleConfirmCpf = async () => {
    if (!token || !validateCPF(cpfConfirmValue) || cpfConfirmSubmitting) return
    setCpfConfirmSubmitting(true)
    setCpfConfirmError(null)
    try {
      const res = await authService.confirmCpf(cpfConfirmValue.replace(/\D/g, ''), token)
      setData(prev => (prev ? { ...prev, cpf_masked: res.cpf_masked } : prev))
      if (user) setUser({ ...user, cpfMasked: res.cpf_masked })
    } catch (e) {
      const code = e instanceof authService.BffError ? e.code : 'UNKNOWN'
      setCpfConfirmError(
        code === 'CPF_MISMATCH'  ? t('perfil.dados.confirmCpf.errorMismatch')
        : code === 'RATE_LIMITED' ? t('perfil.dados.confirmCpf.errorRateLimited')
        : t('perfil.dados.confirmCpf.errorGeneric'),
      )
    } finally {
      setCpfConfirmSubmitting(false)
    }
  }

  const handleConfirmCnpj = async () => {
    if (!token || !company || !validateCNPJ(cnpjConfirmValue) || cnpjConfirmSubmitting) return
    setCnpjConfirmSubmitting(true)
    setCnpjConfirmError(null)
    try {
      await companyService.confirmCompanyCnpj(token, company.id, normalizeCNPJ(cnpjConfirmValue))
      await fetchCompanies()
    } catch (e) {
      const code = e instanceof authService.BffError ? e.code : 'UNKNOWN'
      setCnpjConfirmError(
        code === 'CNPJ_MISMATCH' ? t('empresas.dados.confirmCnpj.errorMismatch')
        : code === 'RATE_LIMITED' ? t('empresas.dados.confirmCnpj.errorRateLimited')
        : t('empresas.dados.confirmCnpj.errorGeneric'),
      )
    } finally {
      setCnpjConfirmSubmitting(false)
    }
  }

  if (!isCompany && !user) return null

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('perfil.dados.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
          <Text style={styles.loadingText}>{t('perfil.dados.loading')}</Text>
        </View>
      )}

      {!loading && (error || (isCompany && !company)) && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t('perfil.dados.errorLoad')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.75}>
            <Text style={styles.retryText}>{t('perfil.dados.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && isCompany && company && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <DataRow label={t('empresas.dados.razaoSocial')}  value={company.company_name} />
          <DataRow label={t('empresas.dados.nomeFantasia')} value={company.trading_name || '—'} />
          {company.cnpj_masked ? (
            <DataRow label={t('empresas.dados.cnpj')} value={company.cnpj_masked} />
          ) : (
            <View style={styles.confirmBlock}>
              <AlertCard tone="info" text={t('empresas.dados.confirmCnpj.subtitle')} />
              <Field
                label={t('empresas.dados.confirmCnpj.title')}
                value={cnpjConfirmValue}
                onChangeText={v => { setCnpjConfirmValue(maskCNPJ(v)); setCnpjConfirmError(null) }}
                placeholder={t('empresas.dados.confirmCnpj.placeholder')}
                autoCapitalize="characters"
                error={cnpjConfirmError}
              />
              <PrimaryButton
                label={t('empresas.dados.confirmCnpj.cta')}
                onPress={handleConfirmCnpj}
                state={!validateCNPJ(cnpjConfirmValue) ? 'disabled' : cnpjConfirmSubmitting ? 'loading' : 'default'}
              />
            </View>
          )}
          <DataRow label={t('empresas.dados.handle')}       value={`@${company.handle}`} />

          <Text style={styles.readOnly}>{t('perfil.dados.readOnly')}</Text>
        </ScrollView>
      )}

      {!loading && !error && !isCompany && user && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <DataRow label={t('perfil.dados.name')}    value={user.name} />
          {data?.cpf_masked ? (
            <DataRow label={t('perfil.dados.cpf')} value={data.cpf_masked} />
          ) : (
            <View style={styles.confirmBlock}>
              <AlertCard tone="info" text={t('perfil.dados.confirmCpf.subtitle')} />
              <Field
                label={t('perfil.dados.confirmCpf.title')}
                value={cpfConfirmValue}
                onChangeText={v => { setCpfConfirmValue(maskCPF(v)); setCpfConfirmError(null) }}
                placeholder={t('perfil.dados.confirmCpf.placeholder')}
                keyboardType="numeric"
                error={cpfConfirmError}
              />
              <PrimaryButton
                label={t('perfil.dados.confirmCpf.cta')}
                onPress={handleConfirmCpf}
                state={!validateCPF(cpfConfirmValue) ? 'disabled' : cpfConfirmSubmitting ? 'loading' : 'default'}
              />
            </View>
          )}
          <DataRow label={t('perfil.dados.birth')}   value={data?.birth_masked ?? '—'} />
          <DataRow label={t('perfil.dados.email')}   value={data?.email_masked ?? '—'} />
          <DataRow label={t('perfil.dados.phone')}   value={data?.phone_masked ?? '—'} />
          <DataRow label={t('perfil.dados.address')} value={t('perfil.dados.addressPlaceholder')} />

          <Text style={styles.readOnly}>{t('perfil.dados.readOnly')}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
  confirmBlock: {
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: spacing.md,
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
