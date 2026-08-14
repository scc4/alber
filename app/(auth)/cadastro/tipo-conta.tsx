// Plano CNPJ (velvet-puzzling-sedgewick)
// Primeira tela do cadastro — escolhe entre Pessoa física e Empresa antes de
// entrar no fluxo numerado (dados/endereço/handle/pin/segurança/pix).
// Fica fora da contagem de steps (hideProgress) para não precisar renumerar
// as telas existentes do fluxo pessoal.

import { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { updateDraft } from '../../../store/signup-draft'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type AccountType = 'personal' | 'business'

export default function TipoContaScreen() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<AccountType | null>(null)
  const [wantsPersonalWallet, setWantsPersonalWallet] = useState(true)

  const handleNext = () => {
    if (!selected) return
    updateDraft({
      accountType: selected,
      // Só faz sentido perguntar quando é empresa — pessoa física sempre tem
      // carteira pessoal (é o propósito da conta).
      wantsPersonalWallet: selected === 'business' ? wantsPersonalWallet : true,
    })
    router.push('/(auth)/cadastro/dados')
  }

  return (
    <OnboardShell
      step={0}
      hideProgress
      title={t('auth.onboarding.tipoConta.title')}
      subtitle={t('auth.onboarding.tipoConta.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={selected ? 'default' : 'disabled'}
        />
      }
    >
      <TouchableOpacity
        style={[styles.card, selected === 'personal' && styles.cardActive]}
        onPress={() => setSelected('personal')}
        activeOpacity={0.8}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === 'personal' }}
      >
        <Text style={styles.cardTitle}>{t('auth.onboarding.tipoConta.personalTitle')}</Text>
        <Text style={styles.cardDescription}>{t('auth.onboarding.tipoConta.personalDescription')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.card, selected === 'business' && styles.cardActive]}
        onPress={() => setSelected('business')}
        activeOpacity={0.8}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === 'business' }}
      >
        <Text style={styles.cardTitle}>{t('auth.onboarding.tipoConta.businessTitle')}</Text>
        <Text style={styles.cardDescription}>{t('auth.onboarding.tipoConta.businessDescription')}</Text>
      </TouchableOpacity>

      {selected === 'business' && (
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setWantsPersonalWallet(v => !v)}
          activeOpacity={0.75}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: wantsPersonalWallet }}
        >
          <View style={[styles.checkbox, wantsPersonalWallet && styles.checkboxChecked]}>
            {wantsPersonalWallet && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>{t('auth.onboarding.tipoConta.alsoPersonalWallet')}</Text>
        </TouchableOpacity>
      )}
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: spacing.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: spacing.md,
  },
  cardActive: {
    borderColor: colors.white[100],
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 18,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: spacing.sm,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 18,
  },
})
