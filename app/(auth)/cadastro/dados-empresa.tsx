// Plano CNPJ (velvet-puzzling-sedgewick)
// Dados da empresa — só entra no fluxo quando accountType === 'business'
// (ver tipo-conta.tsx). O endereço da empresa vem primeiro (CEP no topo,
// igual ao padrão de endereco.tsx) — não é mais herdado do endereço pessoal,
// já que este passo também é usado por quem já tem conta e nunca preencheu
// um endereço pessoal nesta sessão (verificar-cpf.tsx, Melhoria 1).

import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { LegalDocModal } from '../../../components/shared/LegalDocModal'
import { getDraft, updateDraft } from '../../../store/signup-draft'
import { validateCNPJ, normalizeCNPJ } from '../../../utils/cnpj'
import { maskCNPJ } from '../../../utils/format'
import { maskBRL, parseBRL } from '../../../utils/currency'
import * as authService from '../../../services/auth.service'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type CnpjStatus = 'idle' | 'checking' | 'duplicate'

type CompanyType = 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION'

const COMPANY_TYPES: { id: CompanyType; labelKey: string }[] = [
  { id: 'MEI',         labelKey: 'auth.onboarding.dadosEmpresa.typeMei' },
  { id: 'LIMITED',     labelKey: 'auth.onboarding.dadosEmpresa.typeLimited' },
  { id: 'INDIVIDUAL',  labelKey: 'auth.onboarding.dadosEmpresa.typeIndividual' },
  { id: 'ASSOCIATION', labelKey: 'auth.onboarding.dadosEmpresa.typeAssociation' },
]

function maskCEP(v: string) {
  v = v.replace(/\D/g, '').slice(0, 8)
  return v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v
}

// Mesmo formato do handle pessoal (ver cadastro/handle.tsx) — a empresa
// também precisa de um @handle próprio pra ser encontrada em transferências.
function validHandleFormat(h: string) {
  return (
    /^[a-z0-9_]{3,20}$/.test(h) &&
    !h.startsWith('_') &&
    !h.endsWith('_') &&
    !h.includes('__')
  )
}

export default function DadosEmpresaScreen() {
  const { t } = useTranslation()
  const draft = getDraft()

  // Endereço da empresa — CEP primeiro, igual ao padrão de endereco.tsx.
  const [cep, setCep]                   = useState(draft.companyCep ?? '')
  const [street, setStreet]             = useState(draft.companyStreet ?? '')
  const [number, setNumber]             = useState(draft.companyNumber ?? '')
  const [complement, setComplement]     = useState(draft.companyComplement ?? '')
  const [neighborhood, setNeighborhood] = useState(draft.companyNeighborhood ?? '')
  const [city, setCity]                 = useState(draft.companyCity ?? '')
  const [uf, setUf]                     = useState(draft.companyState ?? '')
  const [cepLoading, setCepLoading]     = useState(false)
  const [cepLoaded, setCepLoaded]       = useState(false)
  const [cepError, setCepError]         = useState<string | null>(null)
  const [manualCity, setManualCity]     = useState(false)

  const [companyName, setCompanyName]     = useState(draft.companyName ?? '')
  const [tradingName, setTradingName]     = useState(draft.companyTradingName ?? '')
  const [companyHandle, setCompanyHandle] = useState(draft.companyHandle ?? '')
  const [cnpj, setCnpj]                   = useState(draft.cnpj ?? '')
  const [companyType, setCompanyType]     = useState<CompanyType | null>(draft.companyType ?? null)
  const [incomeValue, setIncomeValue]     = useState(draft.companyIncomeValue ?? '')
  const [privacyOpen, setPrivacyOpen]     = useState(false)

  const [touched, setTouch] = useState<Record<string, boolean>>({})
  const touch = (field: string) => setTouch(t2 => ({ ...t2, [field]: true }))

  const cnpjNormalized = normalizeCNPJ(cnpj)
  const cnpjValid  = validateCNPJ(cnpj)

  // Duplicidade de CNPJ (item 46 do QA) — checa em tempo real assim que o
  // CNPJ fica válido, mesmo padrão de duplicidade de CPF em cadastro/dados.tsx.
  const [cnpjStatus, setCnpjStatus] = useState<CnpjStatus>('idle')
  const cnpjCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (cnpjCheckTimer.current) clearTimeout(cnpjCheckTimer.current)
    if (!cnpjValid) {
      setCnpjStatus('idle')
      return
    }
    setCnpjStatus('checking')
    cnpjCheckTimer.current = setTimeout(async () => {
      try {
        const exists = await authService.checkCnpjExists(cnpjNormalized)
        setCnpjStatus(exists ? 'duplicate' : 'idle')
      } catch {
        setCnpjStatus('idle')
      }
    }, 500)
    return () => { if (cnpjCheckTimer.current) clearTimeout(cnpjCheckTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpjNormalized, cnpjValid])

  useEffect(() => {
    const digits = cep.replace(/\D/g, '')

    if (digits.length < 8) {
      if (cepLoaded) {
        setStreet(''); setNeighborhood(''); setCity(''); setUf('')
        setCepLoaded(false); setCepError(null); setManualCity(false)
      }
      return
    }

    if (cepLoaded) return

    const controller = new AbortController()
    setCepLoading(true)
    setCepError(null)
    setManualCity(false)

    fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: controller.signal })
      .then(res => res.json())
      .then((data: Record<string, unknown>) => {
        if (data.erro) {
          setStreet(''); setNeighborhood(''); setCity(''); setUf('')
          setCepError(t('auth.onboarding.endereco.cepNotFound'))
        } else {
          setStreet(String(data.logradouro ?? ''))
          setNeighborhood(String(data.bairro ?? ''))
          setCity(String(data.localidade ?? ''))
          setUf(String(data.uf ?? ''))
          setCepLoaded(true)
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return
        setCepError(t('auth.onboarding.endereco.cepNetworkError'))
        setManualCity(true)
      })
      .finally(() => setCepLoading(false))

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cep, cepLoaded, t])

  const companyHandleValid = validHandleFormat(companyHandle)

  const errors = {
    cnpj: cnpjNormalized.length === 14 && !cnpjValid ? t('auth.onboarding.dadosEmpresa.cnpjError') : null,
    handle: companyHandle.length >= 3 && !companyHandleValid ? t('auth.onboarding.dadosEmpresa.handleError') : null,
  }

  const isReady =
    cep.replace(/\D/g, '').length === 8 &&
    street.trim().length > 0 &&
    number.trim().length > 0 &&
    neighborhood.trim().length > 0 &&
    city.trim().length > 0 &&
    uf.trim().length > 0 &&
    companyName.trim().length > 1 &&
    companyHandleValid &&
    cnpjValid &&
    cnpjStatus === 'idle' &&
    companyType !== null &&
    parseBRL(incomeValue) > 0

  const handleNext = () => {
    if (!isReady || !companyType) return
    updateDraft({
      companyName,
      companyTradingName: tradingName,
      companyHandle,
      cnpj,
      companyType,
      companyIncomeValue: incomeValue,
      companyCep: cep,
      companyStreet: street,
      companyNumber: number,
      companyComplement: complement,
      companyNeighborhood: neighborhood,
      companyCity: city,
      companyState: uf,
    })
    router.push('/(auth)/cadastro/empresa-pix')
  }

  return (
    <>
    <OnboardShell
      step={1}
      title={t('auth.onboarding.dadosEmpresa.title')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={isReady ? 'default' : 'disabled'}
        />
      }
    >
      {/* Subtítulo com link para a Política de Privacidade (item 50, mesmo
          padrão do item 24 na PF em cadastro/dados.tsx) */}
      <Text style={styles.subtitle}>
        {t('auth.onboarding.dadosEmpresa.subtitle', { link: '' })}
        <Text style={styles.subtitleLink} onPress={() => setPrivacyOpen(true)} suppressHighlighting>
          {t('auth.onboarding.terms.privacyPolicy')}
        </Text>
      </Text>

      <Text style={styles.sectionTitle}>{t('auth.onboarding.dadosEmpresa.addressSection')}</Text>
      <Text style={styles.sectionHint}>{t('auth.onboarding.dadosEmpresa.addressHint')}</Text>

      <Field
        label={t('auth.onboarding.endereco.cep')}
        value={cep}
        onChangeText={v => {
          setCep(maskCEP(v))
          setCepLoaded(false)
          setCepError(null)
          setManualCity(false)
        }}
        placeholder={t('auth.onboarding.endereco.cepPlaceholder')}
        keyboardType="numeric"
        autoFocus
        loading={cepLoading}
        success={cepLoaded}
        error={cepError}
        hint={cepLoaded ? t('auth.onboarding.endereco.cepFound') : null}
      />

      <Field
        label={t('auth.onboarding.endereco.street')}
        value={street}
        onChangeText={setStreet}
        editable={!cepLoading}
      />

      <View style={styles.row}>
        <View style={styles.col40}>
          <Field
            label={t('auth.onboarding.endereco.number')}
            value={number}
            onChangeText={setNumber}
            keyboardType="numeric"
          />
        </View>
        <View style={styles.col60}>
          <Field
            label={t('auth.onboarding.endereco.complement')}
            value={complement}
            onChangeText={setComplement}
          />
        </View>
      </View>

      <Field
        label={t('auth.onboarding.endereco.neighborhood')}
        value={neighborhood}
        onChangeText={setNeighborhood}
        editable={!cepLoading}
      />

      <View style={styles.row}>
        <View style={styles.col60}>
          <Field
            label={t('auth.onboarding.endereco.city')}
            value={city}
            onChangeText={setCity}
            editable={manualCity && !cepLoading}
            readOnly={!manualCity}
          />
        </View>
        <View style={styles.col30}>
          <Field
            label={t('auth.onboarding.endereco.state')}
            value={uf}
            onChangeText={setUf}
            editable={manualCity && !cepLoading}
            readOnly={!manualCity}
          />
        </View>
      </View>

      <Field
        label={t('auth.onboarding.dadosEmpresa.companyName')}
        value={companyName}
        onChangeText={setCompanyName}
        placeholder={t('auth.onboarding.dadosEmpresa.companyNamePlaceholder')}
      />

      <Field
        label={t('auth.onboarding.dadosEmpresa.tradingName')}
        value={tradingName}
        onChangeText={setTradingName}
        placeholder={t('auth.onboarding.dadosEmpresa.tradingNamePlaceholder')}
      />

      <Field
        label={t('auth.onboarding.dadosEmpresa.handle')}
        value={companyHandle}
        onChangeText={v => {
          const clean = v.toLowerCase().replace(/[^a-z0-9_]/g, '')
          setCompanyHandle(clean)
          if (clean.length >= 3) touch('handle')
        }}
        placeholder={t('auth.onboarding.dadosEmpresa.handlePlaceholder')}
        hint={t('auth.onboarding.dadosEmpresa.handleHint')}
        autoCapitalize="none"
        autoCorrect={false}
        onBlur={() => touch('handle')}
        error={touched.handle ? errors.handle : null}
      />

      <Field
        label={t('auth.onboarding.dadosEmpresa.cnpj')}
        value={cnpj}
        onChangeText={v => {
          const masked = maskCNPJ(v)
          setCnpj(masked)
          if (normalizeCNPJ(masked).length === 14) touch('cnpj')
        }}
        placeholder={t('auth.onboarding.dadosEmpresa.cnpjPlaceholder')}
        autoCapitalize="characters"
        onBlur={() => touch('cnpj')}
        loading={cnpjStatus === 'checking'}
        error={touched.cnpj ? errors.cnpj : null}
      />
      {touched.cnpj && cnpjStatus === 'duplicate' && (
        <View style={styles.duplicateBox}>
          <Text style={styles.duplicateBoxText}>
            {t('auth.onboarding.dadosEmpresa.cnpjDuplicateInline')}
          </Text>
        </View>
      )}

      <Text style={styles.label}>{t('auth.onboarding.dadosEmpresa.companyType')}</Text>
      <View style={styles.typeGrid}>
        {COMPANY_TYPES.map(({ id, labelKey }) => (
          <TouchableOpacity
            key={id}
            style={[styles.typeBtn, companyType === id && styles.typeBtnActive]}
            onPress={() => setCompanyType(id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.typeBtnText, companyType === id && styles.typeBtnTextActive]}>
              {t(labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Field
        label={t('auth.onboarding.dadosEmpresa.incomeValue')}
        value={incomeValue}
        onChangeText={v => setIncomeValue(maskBRL(v))}
        placeholder={t('auth.onboarding.dadosEmpresa.incomeValuePlaceholder')}
        keyboardType="numeric"
        hint={t('auth.onboarding.dadosEmpresa.incomeValueHint')}
      />
    </OnboardShell>
    <LegalDocModal
      visible={privacyOpen}
      title={t('auth.onboarding.terms.privacyPolicy')}
      body={t('auth.onboarding.terms.privacyPolicyBody')}
      onClose={() => setPrivacyOpen(false)}
    />
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  col40: { flex: 0.7 },
  col60: { flex: 1.4 },
  col30: { flex: 0.5 },
  label: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.42)',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 19,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  subtitleLink: {
    color: colors.white[100],
    textDecorationLine: 'underline',
  },
  sectionHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 17,
    fontFamily: typography.fontFamily.primary,
    marginTop: -6,
    marginBottom: spacing.md,
  },
  duplicateBox: {
    marginTop: -10,
    marginBottom: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(245,158,11,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.22)',
    borderRadius: spacing.radius.md,
  },
  duplicateBoxText: {
    fontSize: 12,
    color: colors.warning[500],
    lineHeight: 17,
    fontFamily: typography.fontFamily.primary,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.md,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  typeBtn: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
  },
  typeBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.40)',
  },
  typeBtnText: {
    fontSize: 12.5,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontWeight: '400',
    textAlign: 'center',
  },
  typeBtnTextActive: {
    fontWeight: '600',
  },
})
