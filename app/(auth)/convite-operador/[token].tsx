// Plano CNPJ (velvet-puzzling-sedgewick)
// Deep link: alber://convite-operador/{token}
// Entrada para quem nunca usou o Alber e foi convidado a operar uma empresa.
// Quem já tem conta deve ser convidado por @handle direto no app (ver
// empresas/[id]/operadores.tsx) — este fluxo é só para gente nova, e cria a
// pessoa sem carteira pessoal, direto no cadastro enxuto.

import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { useAuthStore } from '../../../store/auth.store'
import { updateDraft } from '../../../store/signup-draft'
import * as companyService from '../../../services/company.service'
import { colors } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

export default function ConviteOperadorScreen() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { t }      = useTranslation()
  const isLoggedIn = useAuthStore(s => s.isAuthenticated)

  const [companyName, setCompanyName] = useState<string | null>(null)
  const [valid, setValid]             = useState<boolean | null>(null)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    if (!token) return
    companyService.previewInvite(token)
      .then(res => {
        setValid(res.valid)
        setCompanyName(res.company_name)
      })
      .catch(() => setValid(false))
      .finally(() => setLoading(false))
  }, [token])

  const handleStart = () => {
    if (!token) return
    updateDraft({ accountType: 'personal', wantsPersonalWallet: false, inviteToken: token })
    router.push('/(auth)/cadastro/dados')
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color={colors.white[100]} />
      </View>
    )
  }

  if (isLoggedIn) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{t('convite.operador.alreadyLoggedInTitle')}</Text>
        <Text style={styles.body}>{t('convite.operador.alreadyLoggedInBody')}</Text>
        <PrimaryButton label={t('convite.operador.backCta')} onPress={() => router.replace('/(app)/')} />
      </View>
    )
  }

  if (!valid) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{t('convite.operador.invalidTitle')}</Text>
        <Text style={styles.body}>{t('convite.operador.invalidBody')}</Text>
        <PrimaryButton label={t('convite.operador.backCta')} onPress={() => router.replace('/(auth)/welcome')} />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('convite.operador.title')}</Text>
      <Text style={styles.body}>
        {t('convite.operador.body', { company: companyName ?? t('convite.operador.genericCompany') })}
      </Text>
      <PrimaryButton label={t('convite.operador.startCta')} onPress={handleStart} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
    lineHeight: 20,
  },
})
