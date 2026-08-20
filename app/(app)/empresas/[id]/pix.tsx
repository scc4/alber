// Plano CNPJ (velvet-puzzling-sedgewick)
// Configuração da chave Pix de SAQUE da empresa — só o master acessa.
// Libera o financial-descarregar. Exige PIN + confirmação de segurança do
// master (spec 05_security.md §4 "Cadastrar/trocar chave Pix"), mesmo
// padrão do fluxo Pix pessoal em perfil/seguranca.tsx.
//
// Regra: CNPJ é o padrão gravado automaticamente no cadastro — uma vez
// configurada (qualquer tipo), a tela vira só informativa, sem campo nem
// botão. Só quando a empresa ainda não tem NENHUMA chave (pix_key_type
// nulo — cadastro antigo ou caminho que não mandou pix_key_type) é que o
// master pode digitar o CNPJ (reconfirma contra o hash já cadastrado) ou
// colar uma chave aleatória (EVP) já gerada no banco real da empresa.

import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Header } from '../../../../components/core/Header'
import { Field } from '../../../../components/core/Field'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { PINInput } from '../../../../components/financial/PINInput'
import { SecurityConfirmation } from '../../../../components/financial/SecurityConfirmation'
import { useAuthStore } from '../../../../store/auth.store'
import * as companyService from '../../../../services/company.service'
import { BffError } from '../../../../services/auth.service'
import { validateCNPJ, normalizeCNPJ } from '../../../../utils/cnpj'
import { isValidEvpKey } from '../../../../utils/pix'
import { maskCNPJ } from '../../../../utils/format'
import { colors } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

type KeyType = 'cnpj' | 'random'
type Step    = 'loading' | 'error' | 'configured' | 'input' | 'pin' | 'security' | 'success'

export default function EmpresaPixKeyScreen() {
  const { t }  = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const token  = useAuthStore(s => s.token)
  const user   = useAuthStore(s => s.user)

  const [step, setStep]       = useState<Step>('loading')
  const [configured, setConfigured] = useState<{ type: KeyType; cnpjMasked: string | null } | null>(null)

  const [type, setType]       = useState<KeyType>('cnpj')
  const [cnpj, setCnpj]       = useState('')
  const [randomKey, setRandomKey] = useState('')
  const [pinHash, setPinHash] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [wrongAnswer, setWrongAnswer] = useState(false)
  const [result, setResult]   = useState<{ pix_key_masked: string; pix_key_type: string } | null>(null)

  useEffect(() => {
    if (!token || !id) return
    let cancelled = false
    companyService.listCompanies(token)
      .then(companies => {
        if (cancelled) return
        const company = companies.find(c => c.id === id)
        if (!company) { setStep('error'); return }
        if (company.pix_key_type) {
          setConfigured({ type: company.pix_key_type, cnpjMasked: company.cnpj_masked })
          setStep('configured')
        } else {
          setStep('input')
        }
      })
      .catch(() => { if (!cancelled) setStep('error') })
    return () => { cancelled = true }
  }, [token, id])

  const cnpjValid = validateCNPJ(cnpj)
  const isReady = type === 'cnpj' ? cnpjValid : isValidEvpKey(randomKey)

  const handlePin = (hash: string) => {
    setPinHash(hash)
    setStep('security')
  }

  const handleSecurity = async (answerHash: string) => {
    if (!token || !id || submitting) return
    setSubmitting(true)
    try {
      const res = await companyService.setCompanyPixKey(
        token, id, type, pinHash, answerHash,
        type === 'cnpj' ? normalizeCNPJ(cnpj) : undefined,
        type === 'random' ? randomKey.trim() : undefined,
      )
      setResult(res)
      setStep('success')
    } catch (e) {
      const isBff = e instanceof BffError

      if (isBff && e.code === 'INVALID_CREDENTIALS') {
        if (e.message?.includes('PIN')) {
          setStep('pin')
        } else {
          setWrongAnswer(true)
          setTimeout(() => setWrongAnswer(false), 1800)
        }
        return
      }

      if (isBff && e.code === 'CNPJ_MISMATCH') {
        Alert.alert(t('empresas.pixKey.errorTitle'), t('empresas.pixKey.cnpjMismatch'))
        setStep('input')
        return
      }

      if (isBff && e.code === 'PIX_KEY_INVALID') {
        Alert.alert(t('empresas.pixKey.errorTitle'), t('empresas.pixKey.randomKeyInvalid'))
        setStep('input')
        return
      }

      Alert.alert(t('empresas.pixKey.errorTitle'), isBff ? e.message : t('empresas.pixKey.errorGeneric'))
      setStep('input')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'loading') {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('empresas.pixKey.title')} onBack={() => router.back()} />
        <View style={styles.centerContent}>
          <ActivityIndicator color="rgba(255,255,255,0.6)" />
        </View>
      </View>
    )
  }

  if (step === 'error') {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('empresas.pixKey.title')} onBack={() => router.back()} />
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{t('empresas.pixKey.errorGeneric')}</Text>
        </View>
      </View>
    )
  }

  if (step === 'configured' && configured) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('empresas.pixKey.title')} onBack={() => router.back()} />
        <View style={styles.content}>
          <Text style={styles.subtitle}>{t('empresas.pixKey.configuredTitle')}</Text>
          <Text style={styles.successBody}>
            {configured.type === 'cnpj'
              ? t('empresas.pixKey.configuredInfoCnpj', { cnpj: configured.cnpjMasked ?? t('empresas.pixKey.typeCnpj') })
              : t('empresas.pixKey.configuredInfoRandom')}
          </Text>
        </View>
      </View>
    )
  }

  if (step === 'success' && result) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('empresas.pixKey.title')} onBack={() => router.back()} />
        <View style={styles.content}>
          <Text style={styles.successTitle}>{t('empresas.pixKey.successTitle')}</Text>
          <Text style={styles.successBody}>{result.pix_key_masked}</Text>
          <PrimaryButton label={t('empresas.pixKey.doneCta')} onPress={() => router.back()} />
        </View>
      </View>
    )
  }

  if (step === 'pin') {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('empresas.pixKey.title')} onBack={() => setStep('input')} />
        <View style={styles.content}>
          <Text style={styles.subtitle}>{t('empresas.pixKey.pinSubtitle')}</Text>
          <PINInput mode="secure" onComplete={handlePin} />
        </View>
      </View>
    )
  }

  if (step === 'security') {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('empresas.pixKey.title')} onBack={() => setStep('pin')} />
        <View style={styles.content}>
          <SecurityConfirmation
            identifier={`@${user?.handle ?? ''}`}
            pinHash={pinHash}
            eyebrow={t('empresas.pixKey.securityEyebrow')}
            submitting={submitting}
            wrongAnswer={wrongAnswer}
            onPass={handleSecurity}
          />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <Header variant="title" title={t('empresas.pixKey.title')} onBack={() => router.back()} />
      <View style={styles.content}>
        <Text style={styles.subtitle}>{t('empresas.pixKey.subtitle')}</Text>

        <View style={styles.typeGrid}>
          <TouchableOpacity
            style={[styles.typeBtn, type === 'cnpj' && styles.typeBtnActive]}
            onPress={() => setType('cnpj')}
          >
            <Text style={[styles.typeBtnText, type === 'cnpj' && styles.typeBtnTextActive]}>
              {t('empresas.pixKey.typeCnpj')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, type === 'random' && styles.typeBtnActive]}
            onPress={() => setType('random')}
          >
            <Text style={[styles.typeBtnText, type === 'random' && styles.typeBtnTextActive]}>
              {t('empresas.pixKey.typeRandom')}
            </Text>
          </TouchableOpacity>
        </View>

        {type === 'cnpj' && (
          <Field
            label={t('empresas.pixKey.cnpjLabel')}
            value={cnpj}
            onChangeText={v => setCnpj(maskCNPJ(v))}
            placeholder={t('empresas.pixKey.cnpjPlaceholder')}
            autoCapitalize="characters"
            hint={t('empresas.pixKey.cnpjHint')}
          />
        )}

        {type === 'random' && (
          <>
            <Text style={styles.randomHint}>{t('empresas.pixKey.randomHint')}</Text>
            <Field
              label={t('empresas.pixKey.randomKeyLabel')}
              value={randomKey}
              onChangeText={setRandomKey}
              placeholder={t('empresas.pixKey.randomKeyPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        )}

        <PrimaryButton
          label={t('empresas.pixKey.submitCta')}
          onPress={() => setStep('pin')}
          state={!isReady ? 'disabled' : 'default'}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  errorText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  typeGrid: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  typeBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: spacing.radius.md,
  },
  typeBtnActive: { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.40)' },
  typeBtnText: { fontSize: 13, color: colors.white[100], fontFamily: typography.fontFamily.primary },
  typeBtnTextActive: { fontWeight: '600' },
  randomHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  successBody: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
})
