// Design: /design/auth.jsx — StepAddress
// Spec: /specs/06_modules/onboarding.md seção 3.4 — CEP auto-preenche via ViaCEP

import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { getDraft, updateDraft } from '../../../store/signup-draft'

function maskCEP(v: string) {
  v = v.replace(/\D/g, '').slice(0, 8)
  return v.length > 5 ? `${v.slice(0,5)}-${v.slice(5)}` : v
}

export default function EnderecoScreen() {
  const { t } = useTranslation()

  const [cep, setCep]                   = useState('')
  const [street, setStreet]             = useState('')
  const [number, setNumber]             = useState('')
  const [complement, setComplement]     = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [city, setCity]                 = useState('')
  const [uf, setUf]                     = useState('')
  const [cepLoading, setCepLoading]     = useState(false)
  const [cepLoaded, setCepLoaded]       = useState(false)
  const [cepError, setCepError]         = useState<string | null>(null)
  const [manualCity, setManualCity]     = useState(false)

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
  }, [cep, cepLoaded, t])

  const isReady =
    cep.replace(/\D/g,'').length === 8 &&
    street.trim().length > 0 &&
    number.trim().length > 0 &&
    neighborhood.trim().length > 0 &&
    city.trim().length > 0 &&
    uf.trim().length > 0

  const handleNext = () => {
    updateDraft({ cep, street, number, complement, neighborhood, city, state: uf })
    const next = getDraft().accountType === 'business'
      ? '/(auth)/cadastro/dados-empresa'
      : '/(auth)/cadastro/handle'
    router.push(next)
  }

  return (
    <OnboardShell
      step={1}
      title={t('auth.onboarding.endereco.title')}
      subtitle={t('auth.onboarding.endereco.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={isReady ? 'default' : 'disabled'}
        />
      }
    >
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
        loading={cepLoading}
        success={cepLoaded}
        error={cepError}
        hint={cepLoaded ? t('auth.onboarding.endereco.cepFound') : null}
      />

      <Field
        label={t('auth.onboarding.endereco.street')}
        value={street}
        onChangeText={setStreet}
        placeholder={t('auth.onboarding.endereco.streetPlaceholder')}
        editable={!cepLoading}
      />

      <View style={styles.row}>
        <View style={styles.col40}>
          <Field
            label={t('auth.onboarding.endereco.number')}
            value={number}
            onChangeText={setNumber}
            placeholder={t('auth.onboarding.endereco.numberPlaceholder')}
            keyboardType="numeric"
          />
        </View>
        <View style={styles.col60}>
          <Field
            label={t('auth.onboarding.endereco.complement')}
            value={complement}
            onChangeText={setComplement}
            placeholder={t('auth.onboarding.endereco.complementPlaceholder')}
          />
        </View>
      </View>

      <Field
        label={t('auth.onboarding.endereco.neighborhood')}
        value={neighborhood}
        onChangeText={setNeighborhood}
        placeholder="—"
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
            placeholder="—"
          />
        </View>
        <View style={styles.col30}>
          <Field
            label={t('auth.onboarding.endereco.state')}
            value={uf}
            onChangeText={setUf}
            editable={manualCity && !cepLoading}
            readOnly={!manualCity}
            placeholder="—"
          />
        </View>
      </View>
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  col40: { flex: 0.7 },
  col60: { flex: 1.4 },
  col30: { flex: 0.5 },
})
