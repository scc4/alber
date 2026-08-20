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
import { LegalDocModal } from '../../../components/shared/LegalDocModal'
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
type ModalKey = 'uso' | 'priv' | 'transparency' | null

// Checkbox com área de toque própria pro texto (item 47) — mesma correção já
// aplicada em cadastro/terms.tsx: um TouchableOpacity envolvendo a linha
// inteira captura o toque antes do link aninhado conseguir abrir o modal.
function Check({ on, onPress, children }: { on: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.checkRow}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}>
        <View style={[styles.checkbox, on && styles.checkboxChecked]}>
          {on && <Text style={styles.checkmark}>✓</Text>}
        </View>
      </TouchableOpacity>
      <Text style={styles.checkText} onPress={onPress} suppressHighlighting>
        {children}
      </Text>
    </View>
  )
}

export default function EmpresaPixScreen() {
  const { t }     = useTranslation()
  const draft     = getDraft()
  const token     = useAuthStore(s => s.token)
  const logout    = useAuthStore(s => s.logout)

  const [type, setType]         = useState<PixType>('cnpj')
  const [isCreating, setIsCreating] = useState(false)

  const isExistingAccount = !!draft.existingAccountFlow

  // Aceite de Termos/Privacidade + declaração Asaas (item 47 e 48 do QA) — só
  // se aplica ao fluxo "conta já existente" (Melhoria 1), que cria a empresa
  // direto por aqui sem passar por cadastro/terms.tsx. No fluxo bundlado
  // (cadastro novo), o aceite de terms.tsx já cobre a criação da empresa.
  const [t1, setT1]             = useState(false) // Termos de Uso
  const [t2, setT2]             = useState(false) // Política de Privacidade
  const [asaasDisclosed, setAsaasDisclosed] = useState(false)
  const [modal, setModal]       = useState<ModalKey>(null)

  const consentReady = !isExistingAccount || (t1 && t2 && asaasDisclosed)

  const handleSubmit = async () => {
    if (isCreating || !consentReady) return

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
        terms_accepted: true,
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

  const modalTitle = modal === 'uso' ? t('auth.onboarding.terms.termsOfUse')
    : modal === 'priv' ? t('auth.onboarding.terms.privacyPolicy')
    : modal === 'transparency' ? t('auth.onboarding.terms.financialTransparency')
    : ''
  const modalBody = modal === 'uso' ? t('auth.onboarding.terms.termsOfUseBody')
    : modal === 'priv' ? t('auth.onboarding.terms.privacyPolicyBody')
    : modal === 'transparency' ? t('auth.onboarding.terms.financialTransparencyBody')
    : ''

  return (
    <>
    <OnboardShell
      step={2}
      title={t('auth.onboarding.empresaPix.title')}
      subtitle={t('auth.onboarding.empresaPix.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleSubmit}
          state={consentReady ? 'default' : 'disabled'}
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

      {/* Mesma titularidade da chave Pix (item 51 do QA) */}
      <Text style={styles.hint}>{t('auth.onboarding.empresaPix.sameOwnershipHint')}</Text>

      {isExistingAccount ? (
        <>
          {/* Aceite de Termos/Privacidade (item 47) — este é o único ponto do
              fluxo "conta já existente" antes de criar a empresa de fato. */}
          <View style={styles.consentBlock}>
            <Check on={t1} onPress={() => setT1(v => !v)}>
              {t('auth.onboarding.terms.uso', { link_uso: '' })}
              <Text style={styles.link} onPress={() => setModal('uso')} suppressHighlighting>
                {t('auth.onboarding.terms.termsOfUse')}
              </Text>
            </Check>
            <Check on={t2} onPress={() => setT2(v => !v)}>
              {t('auth.onboarding.terms.privacy', { link_priv: '' })}
              <Text style={styles.link} onPress={() => setModal('priv')} suppressHighlighting>
                {t('auth.onboarding.terms.privacyPolicy')}
              </Text>
            </Check>
            <TouchableOpacity onPress={() => setModal('transparency')} style={styles.transparencyLink}>
              <Text style={styles.transparencyLinkText}>{t('auth.onboarding.terms.financialTransparency')}</Text>
            </TouchableOpacity>
          </View>

          {/* Selo institucional Asaas (item 48) */}
          <TouchableOpacity
            style={styles.disclosureRow}
            onPress={() => setAsaasDisclosed(v => !v)}
            activeOpacity={0.75}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: asaasDisclosed }}
          >
            <View style={[styles.checkbox, asaasDisclosed && styles.checkboxChecked]}>
              {asaasDisclosed && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.disclosureText}>
              {t('auth.onboarding.pix.asaasDisclosure')}{' '}
              <Text
                style={styles.disclosureLink}
                onPress={e => { e.stopPropagation(); setModal('transparency') }}
              >
                {t('auth.onboarding.pix.asaasSaibaMais')}
              </Text>
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        // Fluxo bundlado — o aceite completo (incluindo a declaração Asaas)
        // acontece uma única vez em cadastro/terms.tsx para a conta inteira.
        <Text style={styles.asaasInfo}>{t('auth.onboarding.pix.asaasDisclosure')}</Text>
      )}
    </OnboardShell>
    <LegalDocModal
      visible={!!modal}
      title={modalTitle}
      body={modalBody}
      onClose={() => setModal(null)}
    />
    </>
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
    marginBottom: spacing.sm,
  },
  creatingRoot: {
    flex: 1,
    backgroundColor: colors.black[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.4,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: colors.white[100],
    borderColor: colors.white[100],
  },
  checkmark: {
    fontSize: 12,
    color: colors.black[100],
    fontWeight: '700',
    lineHeight: 14,
  },
  checkText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 18,
    fontFamily: typography.fontFamily.primary,
  },
  link: {
    color: colors.white[100],
    textDecorationLine: 'underline',
  },
  transparencyLink: {
    paddingVertical: spacing.sm,
  },
  transparencyLinkText: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.55)',
    textDecorationLine: 'underline',
    fontFamily: typography.fontFamily.primary,
  },
  disclosureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  disclosureText: {
    flex: 1,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 17,
  },
  disclosureLink: {
    color: 'rgba(255,255,255,0.85)',
    textDecorationLine: 'underline',
  },
  asaasInfo: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 17,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
})
