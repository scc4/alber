// Item 6 do plano de correções — chave Pix de SAQUE da própria empresa
// (nunca cpf/phone/email, só CNPJ ou aleatória). Passo final e único do
// cadastro de empresa, reaproveitado nos dois caminhos:
//  - existingAccountFlow (Melhoria 1): já autenticado, cria a empresa aqui
//    mesmo, via company-create.
//  - cadastro novo (bundlado): só guarda a escolha no draft e segue pro
//    resto do fluxo pessoal (handle/pin/segurança/pix) — a criação de fato
//    acontece no fim, via auth-register.

import { useState } from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { getDraft, updateDraft, clearDraft } from '../../../store/signup-draft'
import { useAuthStore } from '../../../store/auth.store'
import * as companyService from '../../../services/company.service'
import { BffError } from '../../../services/auth.service'
import { normalizeCNPJ } from '../../../utils/cnpj'
import { parseBRL } from '../../../utils/currency'
import { resolveInitialRoute } from '../../../hooks/useInitialRoute'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type PixType = 'cnpj' | 'random'

export default function EmpresaPixScreen() {
  const { t }     = useTranslation()
  const draft     = getDraft()
  const token     = useAuthStore(s => s.token)
  const logout    = useAuthStore(s => s.logout)

  const [type, setType]         = useState<PixType>('cnpj')
  const [isCreating, setIsCreating] = useState(false)

  const isExistingAccount = !!draft.existingAccountFlow

  const handleSubmit = async () => {
    if (isCreating) return

    if (!isExistingAccount) {
      updateDraft({ companyPixType: type })
      router.push('/(auth)/cadastro/handle')
      return
    }

    if (!token) {
      Alert.alert(t('auth.onboarding.empresaPix.errorTitle'), t('auth.onboarding.empresaPix.errorGeneric'))
      return
    }

    setIsCreating(true)
    try {
      const res = await companyService.createCompany(token, {
        cnpj:          normalizeCNPJ(draft.cnpj ?? ''),
        handle:        (draft.companyHandle ?? '').replace(/^@/, ''),
        company_name:  draft.companyName ?? '',
        trading_name:  draft.companyTradingName || undefined,
        company_type:  draft.companyType!,
        income_value:  parseBRL(draft.companyIncomeValue ?? ''),
        address: {
          street:       draft.companyStreet ?? '',
          number:       draft.companyNumber ?? 'S/N',
          complement:   draft.companyComplement || undefined,
          neighborhood: draft.companyNeighborhood ?? '',
          zip_code:     (draft.companyCep ?? '').replace(/\D/g, ''),
          city:         draft.companyCity ?? '',
          state:        draft.companyState ?? '',
        },
        pix_key_type: type,
      })

      clearDraft()

      if (res.company_onboarding_url) {
        router.replace({
          pathname: '/(auth)/kyc',
          params: { urls: JSON.stringify([res.company_onboarding_url]), labels: JSON.stringify(['empresa']) },
        })
      } else {
        router.replace((await resolveInitialRoute()) as never)
      }
    } catch (e: unknown) {
      setIsCreating(false)
      const isBff = e instanceof BffError
      const code  = isBff ? e.code : 'UNKNOWN'
      const title = t('auth.onboarding.empresaPix.errorTitle')

      if (code === 'UNAUTHORIZED') {
        await logout()
        Alert.alert(title, t('auth.onboarding.empresaPix.errorGeneric'), [
          { text: 'OK', onPress: () => router.replace('/(auth)/login') },
        ])
      } else if (code === 'CNPJ_DUPLICATE') {
        Alert.alert(title, t('auth.onboarding.empresaPix.cnpjDuplicate'), [
          { text: 'OK', onPress: () => router.push('/(auth)/cadastro/dados-empresa') },
        ])
      } else if (code === 'CNPJ_UNDER_REVIEW') {
        Alert.alert(title, t('auth.onboarding.empresaPix.cnpjUnderReview'), [
          { text: 'OK', onPress: () => router.push('/(auth)/cadastro/dados-empresa') },
        ])
      } else if (code === 'COMPANY_HANDLE_TAKEN') {
        Alert.alert(title, t('auth.onboarding.empresaPix.handleTaken'), [
          { text: 'OK', onPress: () => router.push('/(auth)/cadastro/dados-empresa') },
        ])
      } else {
        Alert.alert(title, isBff && e.message ? e.message : t('auth.onboarding.empresaPix.errorGeneric'))
      }
    }
  }

  if (isCreating) {
    return (
      <View style={styles.creatingRoot}>
        <ActivityIndicator color="rgba(255,255,255,0.6)" size="large" />
      </View>
    )
  }

  return (
    <OnboardShell
      step={2}
      title={t('auth.onboarding.empresaPix.title')}
      subtitle={t('auth.onboarding.empresaPix.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleSubmit}
        />
      }
    >
      <View style={styles.typeGrid}>
        <TouchableOpacity
          style={[styles.typeBtn, type === 'cnpj' && styles.typeBtnActive]}
          onPress={() => setType('cnpj')}
          activeOpacity={0.7}
        >
          <Text style={[styles.typeBtnText, type === 'cnpj' && styles.typeBtnTextActive]}>
            {t('auth.onboarding.empresaPix.typeCnpj')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeBtn, type === 'random' && styles.typeBtnActive]}
          onPress={() => setType('random')}
          activeOpacity={0.7}
        >
          <Text style={[styles.typeBtnText, type === 'random' && styles.typeBtnTextActive]}>
            {t('auth.onboarding.empresaPix.typeRandom')}
          </Text>
        </TouchableOpacity>
      </View>

      {type === 'random' && (
        <Text style={styles.hint}>{t('auth.onboarding.empresaPix.randomHint')}</Text>
      )}
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  typeGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.sm,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: spacing.radius.md,
  },
  typeBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.40)',
  },
  typeBtnText: {
    fontSize: 13,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontWeight: '400',
  },
  typeBtnTextActive: {
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 18,
  },
  creatingRoot: {
    flex: 1,
    backgroundColor: colors.black[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
})
