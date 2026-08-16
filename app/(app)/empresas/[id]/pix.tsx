// Plano CNPJ (velvet-puzzling-sedgewick)
// Configuração da chave Pix de SAQUE da empresa — só o master acessa.
// Libera o financial-descarregar. Exige PIN + confirmação de segurança do
// master (spec 05_security.md §4 "Cadastrar/trocar chave Pix"), mesmo
// padrão do fluxo Pix pessoal em perfil/seguranca.tsx.

import { useState } from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
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
import { maskCNPJ } from '../../../../utils/format'
import { colors } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

type KeyType = 'cnpj' | 'random'
type Step    = 'input' | 'pin' | 'security' | 'success'

export default function EmpresaPixKeyScreen() {
  const { t }  = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const token  = useAuthStore(s => s.token)
  const user   = useAuthStore(s => s.user)

  const [step, setStep]       = useState<Step>('input')
  const [type, setType]       = useState<KeyType>('cnpj')
  const [cnpj, setCnpj]       = useState('')
  const [pinHash, setPinHash] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [wrongAnswer, setWrongAnswer] = useState(false)
  const [result, setResult]   = useState<{ pix_key_masked: string; pix_key_type: string } | null>(null)

  const cnpjValid = validateCNPJ(cnpj)
  const isReady = type === 'random' || cnpjValid

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

      Alert.alert(t('empresas.pixKey.errorTitle'), isBff ? e.message : t('empresas.pixKey.errorGeneric'))
      setStep('input')
    } finally {
      setSubmitting(false)
    }
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
          <Text style={styles.randomHint}>{t('empresas.pixKey.randomHint')}</Text>
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
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 19,
    marginBottom: spacing.sm,
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
  },
})
