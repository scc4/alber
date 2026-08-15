// Design: /design/auth.jsx — TermsScreen
// Spec: /specs/06_modules/onboarding.md seção 3.9
// Último passo do cadastro — só agora chama auth-register e inicia sessão.
// Consentimentos separados (item 19 da revisão): Termos de Uso, Política de
// Privacidade e maioridade são obrigatórios; newsletter/push é opcional e
// fica num checkbox à parte, nunca junto do aceite obrigatório.

import { useEffect, useRef, useState } from 'react'
import { Alert, Animated, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { getDraft, clearDraft } from '../../../store/signup-draft'
import { useAuthStore } from '../../../store/auth.store'
import * as authService from '../../../services/auth.service'
import { normalizeCNPJ } from '../../../utils/cnpj'
import { parseBRL } from '../../../utils/currency'
import { resolveInitialRoute } from '../../../hooks/useInitialRoute'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

// DD/MM/YYYY → YYYY-MM-DD
function parseBirthDate(dmy: string): string {
  const [d, m, y] = dmy.split('/')
  return `${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}`
}

const CREATING_STEPS_KEYS = [
  'auth.onboarding.creating.step1',
  'auth.onboarding.creating.step2',
  'auth.onboarding.creating.step3',
  'auth.onboarding.creating.step4',
]

// ── Tela de criação em progresso ──────────────────────────────────────────────

function CreatingScreen({ step }: { step: number }) {
  const { t } = useTranslation()
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start()
    return () => { opacity.setValue(0) }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={creating.root}>
      <View style={creating.center}>
        <View style={creating.dotsRow}>
          {CREATING_STEPS_KEYS.map((_, i) => (
            <View
              key={i}
              style={[creating.dot, i <= step ? creating.dotActive : creating.dotIdle]}
            />
          ))}
        </View>
        <Animated.Text style={[creating.label, { opacity }]}>
          {t(CREATING_STEPS_KEYS[step] ?? CREATING_STEPS_KEYS[0])}
        </Animated.Text>
      </View>
    </View>
  )
}

// ── Checkbox de consentimento ───────────────────────────────────────────────

function Check({ on, onPress, children }: { on: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.checkbox, on && styles.checkboxChecked]}>
        {on && <Text style={styles.checkmark}>✓</Text>}
      </View>
      <Text style={styles.checkText}>{children}</Text>
    </TouchableOpacity>
  )
}

type ModalKey = 'uso' | 'priv' | 'transparency' | null

export default function TermsScreen() {
  const { t }        = useTranslation()
  const setSession    = useAuthStore(s => s.setSession)

  const [t1, setT1] = useState(false) // Termos de Uso
  const [t2, setT2] = useState(false) // Política de Privacidade
  const [t3, setT3] = useState(false) // Maioridade
  const [marketingOptIn, setMarketingOptIn] = useState(false) // opcional, separado

  const [modal, setModal]             = useState<ModalKey>(null)
  const [isCreating, setIsCreating]   = useState(false)
  const [creatingStep, setCreatingStep] = useState(0)

  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isCreating) {
      setCreatingStep(0)
      stepTimer.current = setInterval(() => {
        setCreatingStep(s => Math.min(s + 1, CREATING_STEPS_KEYS.length - 1))
      }, 1400)
    } else if (stepTimer.current) {
      clearInterval(stepTimer.current)
    }
    return () => { if (stepTimer.current) clearInterval(stepTimer.current) }
  }, [isCreating])

  const ready = t1 && t2 && t3

  const handleCreate = async () => {
    if (!ready || isCreating) return

    const d = getDraft()
    const noPersonalWallet =
      (d.accountType === 'business' && d.wantsPersonalWallet === false) || !!d.inviteToken

    if (!d.name || !d.cpf || !d.birth || !d.email || !d.phone ||
        !d.pinHash || !d.security?.length || !d.handle) {
      Alert.alert(t('auth.onboarding.pix.errorTitle'), t('auth.onboarding.pix.errorGeneric'))
      return
    }
    if (d.accountType === 'business' && (!d.companyName || !d.companyHandle || !d.cnpj || !d.companyType || !d.companyIncomeValue)) {
      Alert.alert(t('auth.onboarding.pix.errorTitle'), t('auth.onboarding.pix.errorGeneric'))
      return
    }

    setIsCreating(true)

    try {
      const input: authService.RegisterInput = {
        name:       d.name,
        email:      d.email,
        cpf:        d.cpf.replace(/\D/g, ''),
        birth_date: parseBirthDate(d.birth),
        phone:      d.phone.replace(/\D/g, ''),
        address: {
          street:       d.street ?? '',
          number:       d.number ?? 'S/N',
          complement:   d.complement || undefined,
          neighborhood: d.neighborhood ?? '',
          zip_code:     (d.cep ?? '').replace(/\D/g, ''),
          city:         d.city ?? '',
          state:        d.state ?? '',
        },
        handle:             d.handle.replace(/^@/, ''),
        pin_hash:           d.pinHash,
        security_questions: d.security.map(q => ({
          question:    q.question,
          answer_hash: q.answerHash,
          answer_text: q.answerText,
        })),
        ...(!noPersonalWallet && d.pixKey && d.pixType && {
          pix_key:      d.pixKey,
          pix_key_type: d.pixType,
        }),
        create_personal_wallet: !noPersonalWallet,
        ...(d.inviteToken && { invite_token: d.inviteToken }),
        terms_accepted: true,
        marketing_opt_in: marketingOptIn,
        ...(d.accountType === 'business' && {
          company: {
            cnpj:          normalizeCNPJ(d.cnpj ?? ''),
            handle:        (d.companyHandle ?? '').replace(/^@/, ''),
            company_name:  d.companyName ?? '',
            trading_name:  d.companyTradingName || undefined,
            company_type:  d.companyType!,
            income_value:  parseBRL(d.companyIncomeValue ?? ''),
            address: {
              street:       d.companyStreet ?? '',
              number:       d.companyNumber ?? 'S/N',
              complement:   d.companyComplement || undefined,
              neighborhood: d.companyNeighborhood ?? '',
              zip_code:     (d.companyCep ?? '').replace(/\D/g, ''),
              city:         d.companyCity ?? '',
              state:        d.companyState ?? '',
            },
            ...(d.companyPixType && { pix_key_type: d.companyPixType }),
          },
        }),
      }

      type RegisterWithKyc = authService.RegisterResponse & { onboarding_url?: string | null }
      const res = await authService.register(input) as RegisterWithKyc

      await authService.saveSecurityQuestions(d.security.map(q => q.question))
      await authService.saveSecurityAnswers(d.securityAnswers ?? [])

      await setSession(
        res.token,
        res.refresh_token,
        {
          id:           res.user_id,
          name:         d.name,
          handle:       `@${input.handle}`,
          email:        d.email,
          cpfMasked:    '',
          pixKey:       '',
          pixKeyType:   d.pixType ?? 'cpf',
          hasPersonalWallet: !noPersonalWallet,
        },
        res.kyc_status as 'pending' | 'submitted' | 'approved' | 'rejected',
        res.account_status as 'active' | 'evaluation' | 'blocked',
      )

      clearDraft()

      if (res.company_error) {
        Alert.alert(
          t('auth.onboarding.pix.companyErrorTitle'),
          t('auth.onboarding.pix.companyErrorMessage'),
        )
      }

      if (res.invite_error) {
        Alert.alert(
          t('auth.onboarding.pix.inviteErrorTitle'),
          t('auth.onboarding.pix.inviteErrorMessage'),
        )
      }

      if (res.login_required || !res.token) {
        Alert.alert(
          t('auth.onboarding.pix.loginRequiredTitle'),
          t('auth.onboarding.pix.loginRequiredMessage'),
          [{
            text: t('auth.onboarding.pix.loginRequiredButton'),
            onPress: () => router.replace({ pathname: '/(auth)/login', params: { cpf: input.cpf } }),
          }],
        )
        return
      }

      const kycUrls:   string[] = []
      const kycLabels: string[] = []
      if (res.onboarding_url) { kycUrls.push(res.onboarding_url); kycLabels.push('pessoal') }
      if (res.company_onboarding_url) { kycUrls.push(res.company_onboarding_url); kycLabels.push('empresa') }

      if (kycUrls.length > 0) {
        router.replace({
          pathname: '/(auth)/kyc',
          params: { urls: JSON.stringify(kycUrls), labels: JSON.stringify(kycLabels) },
        })
      } else {
        router.replace((await resolveInitialRoute()) as never)
      }
    } catch (e: unknown) {
      console.log('[terms.register] caught error:', e)
      setIsCreating(false)

      const isBff = e instanceof authService.BffError
      const code  = isBff ? e.code    : 'UNKNOWN'
      const srvMsg = isBff ? e.message : ''
      const title = t('auth.onboarding.pix.errorTitle')

      if (code === 'CPF_DUPLICATE' || code === 'CPF_IN_USE') {
        Alert.alert(
          title,
          'Este CPF já possui uma conta. Recuperar acesso?',
          [
            { text: 'Fechar', style: 'cancel' },
            { text: 'Fazer login', onPress: () => router.replace('/(auth)/login') },
          ],
        )
      } else if (code === 'EMAIL_IN_USE') {
        Alert.alert(
          title,
          'Este e-mail já está em uso. Tente outro e-mail.',
          [{ text: 'OK', onPress: () => router.push('/(auth)/cadastro/dados') }],
        )
      } else if (code === 'HANDLE_TAKEN') {
        Alert.alert(
          title,
          'Este @handle já está em uso. Escolha outro.',
          [{ text: 'OK', onPress: () => router.push('/(auth)/cadastro/handle') }],
        )
      } else if (code === 'CNPJ_INVALID' || code === 'CNPJ_DUPLICATE' || code === 'CNPJ_UNDER_REVIEW' || code === 'COMPANY_MISSING_FIELDS') {
        const message =
          code === 'CNPJ_DUPLICATE'    ? 'Este CNPJ já possui uma conta.' :
          code === 'CNPJ_UNDER_REVIEW' ? 'Este CNPJ já está em processo de verificação por outra conta.' :
          'Confira os dados da empresa e tente novamente.'
        Alert.alert(
          title,
          message,
          [{ text: 'OK', onPress: () => router.push('/(auth)/cadastro/dados-empresa') }],
        )
      } else if (code === 'COMPANY_HANDLE_INVALID' || code === 'COMPANY_HANDLE_TAKEN') {
        Alert.alert(
          title,
          code === 'COMPANY_HANDLE_TAKEN' ? 'Este @handle da empresa já está em uso. Escolha outro.' : 'O @handle da empresa é inválido.',
          [{ text: 'OK', onPress: () => router.push('/(auth)/cadastro/dados-empresa') }],
        )
      } else if (code === 'ASAAS_ERROR') {
        Alert.alert(title, srvMsg || t('auth.onboarding.pix.errorAsaas'))
      } else {
        Alert.alert(title, t('auth.onboarding.pix.errorGeneric'))
      }
    }
  }

  if (isCreating) return <CreatingScreen step={creatingStep} />

  const modalTitle = modal === 'uso' ? t('auth.onboarding.terms.termsOfUse')
    : modal === 'priv' ? t('auth.onboarding.terms.privacyPolicy')
    : modal === 'transparency' ? t('auth.onboarding.terms.financialTransparency')
    : ''
  const modalBody = modal === 'uso' ? t('auth.onboarding.terms.termsOfUseBody')
    : modal === 'priv' ? t('auth.onboarding.terms.privacyPolicyBody')
    : modal === 'transparency' ? t('auth.onboarding.terms.financialTransparencyBody')
    : ''

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerLabel}>{t('auth.onboarding.terms.header')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('auth.onboarding.terms.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.onboarding.terms.subtitle')}</Text>

        <Check on={t1} onPress={() => setT1(v => !v)}>
          {t('auth.onboarding.terms.uso', { link_uso: '' })}
          <Text style={styles.link} onPress={() => setModal('uso')}>{t('auth.onboarding.terms.termsOfUse')}</Text>
        </Check>
        <Check on={t2} onPress={() => setT2(v => !v)}>
          {t('auth.onboarding.terms.privacy', { link_priv: '' })}
          <Text style={styles.link} onPress={() => setModal('priv')}>{t('auth.onboarding.terms.privacyPolicy')}</Text>
        </Check>
        <Check on={t3} onPress={() => setT3(v => !v)}>
          {t('auth.onboarding.terms.majority')}
        </Check>

        <TouchableOpacity onPress={() => setModal('transparency')} style={styles.transparencyLink}>
          <Text style={styles.transparencyLinkText}>{t('auth.onboarding.terms.financialTransparency')}</Text>
        </TouchableOpacity>

        {/* Consentimento opcional — nunca no mesmo checkbox dos obrigatórios acima */}
        <View style={styles.optionalDivider} />
        <Check on={marketingOptIn} onPress={() => setMarketingOptIn(v => !v)}>
          {t('auth.onboarding.terms.marketingOptIn')}
        </Check>

        <View style={styles.spacer} />
        <PrimaryButton
          label={t('auth.onboarding.terms.create')}
          onPress={handleCreate}
          state={ready ? 'default' : 'disabled'}
        />
      </ScrollView>

      <Modal visible={!!modal} transparent animationType="slide" onRequestClose={() => setModal(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalDismiss} onPress={() => setModal(null)} activeOpacity={1} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{modalTitle}</Text>
              <TouchableOpacity onPress={() => setModal(null)}>
                <Text style={styles.modalCloseLink}>{t('auth.onboarding.terms.close')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={styles.modalBody}>{modalBody}</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: { width: 32, padding: 8, marginLeft: -8 },
  backIcon: { fontSize: 24, color: colors.white[100] },
  headerLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.18 * 11,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 24,
    fontFamily: typography.fontFamily.primary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 19,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.07)',
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
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 19,
    fontFamily: typography.fontFamily.primary,
  },
  link: {
    color: colors.white[100],
    textDecorationLine: 'underline',
  },
  transparencyLink: {
    paddingVertical: spacing.sm,
    marginTop: 4,
  },
  transparencyLinkText: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.55)',
    textDecorationLine: 'underline',
    fontFamily: typography.fontFamily.primary,
  },
  optionalDivider: {
    marginTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  spacer: { minHeight: spacing.xl },
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalDismiss: { flex: 1 },
  modalSheet: {
    backgroundColor: colors.black[90],
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.1)',
    maxHeight: '85%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  modalCloseLink: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: typography.fontFamily.primary,
  },
  modalScroll: { flex: 1 },
  modalBody: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 21,
    fontFamily: typography.fontFamily.primary,
  },
})

const creating = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: { backgroundColor: colors.white[100] },
  dotIdle:   { backgroundColor: 'rgba(255,255,255,0.15)' },
  label: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    textAlign: 'center',
    letterSpacing: -0.02 * 17,
  },
})
