// Design: /design/auth.jsx — StepPix
// Spec: /specs/06_modules/onboarding.md seção 3.8
// Spec: /specs/03_backend.md §4.1
// Último passo do cadastro — chama auth-register e inicia sessão

import { useEffect, useRef, useState } from 'react'
import { Alert, Animated, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { getDraft, clearDraft } from '../../../store/signup-draft'
import { useAuthStore } from '../../../store/auth.store'
import * as authService from '../../../services/auth.service'
import { validateCPF } from '../../../utils/cpf'
import { normalizeCNPJ } from '../../../utils/cnpj'
import { parseBRL } from '../../../utils/currency'
import { resolveInitialRoute } from '../../../hooks/useInitialRoute'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

type PixType = 'cpf' | 'phone' | 'email' | 'random'

function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}

function maskPhone(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 10) return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`
  if (v.length > 6)  return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`
  if (v.length > 2)  return `(${v.slice(0,2)}) ${v.slice(2)}`
  return v
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// DD/MM/YYYY → YYYY-MM-DD
function parseBirthDate(dmy: string): string {
  const [d, m, y] = dmy.split('/')
  return `${y}-${m?.padStart(2,'0')}-${d?.padStart(2,'0')}`
}

const PIX_TYPES: { id: PixType; labelKey: string }[] = [
  { id: 'cpf',    labelKey: 'auth.onboarding.pix.cpf' },
  { id: 'phone',  labelKey: 'auth.onboarding.pix.phone' },
  { id: 'email',  labelKey: 'auth.onboarding.pix.email' },
  { id: 'random', labelKey: 'auth.onboarding.pix.random' },
]

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

// ── Tela principal ────────────────────────────────────────────────────────────

export default function PixScreen() {
  const { t }        = useTranslation()
  const setSession   = useAuthStore(s => s.setSession)
  const draft        = getDraft()
  // Master de empresa que optou por não ter carteira pessoal, ou operador
  // vindo de link de convite (plano CNPJ velvet-puzzling-sedgewick) — pula
  // toda a escolha de chave Pix de saque, já que não existe carteira pessoal
  // para sacar.
  const noPersonalWallet =
    (draft.accountType === 'business' && draft.wantsPersonalWallet === false) || !!draft.inviteToken

  const [pixType, setPixType]             = useState<PixType>('cpf')
  const [pixKey, setPixKey]               = useState<string>(maskCPF(draft.cpf ?? ''))
  const [isCreating, setIsCreating]       = useState(false)
  const [creatingStep, setCreatingStep]   = useState(0)
  const [asaasDisclosed, setAsaasDisclosed] = useState(false)
  const [showAsaasModal, setShowAsaasModal] = useState(false)

  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const switchType = (type: PixType) => {
    setPixType(type)
    switch (type) {
      case 'cpf':    setPixKey(maskCPF(draft.cpf ?? '')); break
      case 'phone':  setPixKey(draft.phone ?? ''); break
      case 'email':  setPixKey(draft.email ?? ''); break
      case 'random': setPixKey(generateUUID()); break
    }
  }

  useEffect(() => {
    if (pixType === 'random' && !pixKey) setPixKey(generateUUID())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isCreating) {
      setCreatingStep(0)
      stepTimer.current = setInterval(() => {
        setCreatingStep(s => Math.min(s + 1, CREATING_STEPS_KEYS.length - 1))
      }, 1400)
    } else {
      if (stepTimer.current) clearInterval(stepTimer.current)
    }
    return () => { if (stepTimer.current) clearInterval(stepTimer.current) }
  }, [isCreating])

  const cpfPixValid = pixType !== 'cpf' || validateCPF(pixKey)
  const isReady = noPersonalWallet
    ? asaasDisclosed
    : pixKey.trim().length > 0 && asaasDisclosed && cpfPixValid

  const handleNext = async () => {
    if (!isReady || isCreating) return

    // Validação mínima antes de chamar o backend
    const d = getDraft()
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
        ...(!noPersonalWallet && {
          pix_key:      pixType === 'cpf' ? pixKey.replace(/\D/g, '') : pixKey,
          pix_key_type: pixType,
        }),
        create_personal_wallet: !noPersonalWallet,
        ...(d.inviteToken && { invite_token: d.inviteToken }),
        terms_accepted: true,
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
          pixKeyType:   pixType,
          hasPersonalWallet: !noPersonalWallet,
        },
        res.kyc_status as 'pending' | 'submitted' | 'approved' | 'rejected',
        res.account_status as 'active' | 'evaluation' | 'blocked',
      )

      clearDraft()

      if (res.company_error) {
        // Conta pessoal criada com sucesso — só a empresa teve problema (ex.:
        // instabilidade no Asaas). Pode ser reaberta depois em "Minhas Empresas".
        Alert.alert(
          t('auth.onboarding.pix.companyErrorTitle'),
          t('auth.onboarding.pix.companyErrorMessage'),
        )
      }

      if (res.invite_error) {
        // Conta pessoal criada com sucesso — só o vínculo com a empresa do
        // convite falhou (ex.: convite expirou entre abrir o link e concluir
        // o cadastro). Precisa de um novo convite do master.
        Alert.alert(
          t('auth.onboarding.pix.inviteErrorTitle'),
          t('auth.onboarding.pix.inviteErrorMessage'),
        )
      }

      if (res.login_required || !res.token) {
        // Conta criada com sucesso no backend, mas o login automático falhou
        // (ex.: instabilidade transitória). Não é um erro de cadastro.
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

      // Fila de KYC: pode ter verificação pessoal e de empresa na mesma sessão
      // de cadastro (plano velvet-puzzling-sedgewick) — pessoal primeiro
      // (identidade do representante é a base de tudo), depois a da empresa.
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
      console.log('[pix.register] caught error:', e)
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

  return (
    <OnboardShell
      step={5}
      title={noPersonalWallet ? t('auth.onboarding.pix.titleNoWallet') : t('auth.onboarding.pix.title')}
      subtitle={noPersonalWallet ? t('auth.onboarding.pix.subtitleNoWallet') : t('auth.onboarding.pix.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={isReady ? 'default' : 'disabled'}
        />
      }
    >
      {!noPersonalWallet && (
        <>
          {/* Seletor de tipo */}
          <View style={styles.typeGrid}>
            {PIX_TYPES.map(({ id, labelKey }) => (
              <TouchableOpacity
                key={id}
                style={[styles.typeBtn, pixType === id && styles.typeBtnActive]}
                onPress={() => switchType(id)}
                activeOpacity={0.7}
              >
                <Text style={[styles.typeBtnText, pixType === id && styles.typeBtnTextActive]}>
                  {t(labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Campo da chave */}
          {pixType === 'cpf' && (
            <Field
              label={t('auth.onboarding.pix.cpfLabel')}
              value={pixKey}
              editable={false}
              hint={t('auth.onboarding.pix.cpfHint')}
            />
          )}
          {pixType === 'phone' && (
            <Field
              label={t('auth.onboarding.pix.phoneLabel')}
              value={pixKey}
              onChangeText={v => setPixKey(maskPhone(v))}
              keyboardType="phone-pad"
            />
          )}
          {pixType === 'email' && (
            <Field
              label={t('auth.onboarding.pix.emailLabel')}
              value={pixKey}
              onChangeText={v => setPixKey(v.toLowerCase())}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          )}
          {pixType === 'random' && (
            <Field
              label={t('auth.onboarding.pix.randomLabel')}
              value={pixKey}
              editable={false}
              hint={t('auth.onboarding.pix.randomHint')}
            />
          )}

          <Text style={styles.withdrawalHint}>{t('auth.onboarding.pix.withdrawalHint')}</Text>
        </>
      )}

      {/* Declaração obrigatória Asaas — Playbook BaaS */}
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
            onPress={e => { e.stopPropagation(); setShowAsaasModal(true) }}
          >
            {t('auth.onboarding.pix.asaasSaibaMais')}
          </Text>
        </Text>
      </TouchableOpacity>

      {/* Modal com texto completo */}
      <Modal
        visible={showAsaasModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAsaasModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalDismiss}
            onPress={() => setShowAsaasModal(false)}
            activeOpacity={1}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              <Text style={styles.modalBody}>
                {t('auth.onboarding.pix.asaasModalBody')}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setShowAsaasModal(false)}
              activeOpacity={0.75}
            >
              <Text style={styles.modalCloseText}>
                {t('auth.onboarding.pix.asaasModalClose')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </OnboardShell>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  withdrawalHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 17,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  // Disclosure checkbox
  disclosureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
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
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalDismiss: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: colors.black[90],
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.1)',
    maxHeight: '65%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  modalScroll: {
    flex: 1,
  },
  modalBody: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: 21,
  },
  modalCloseBtn: {
    marginTop: spacing.lg,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: spacing.radius.md,
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },

  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.lg,
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
    fontSize: 13,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontWeight: '400',
  },
  typeBtnTextActive: {
    fontWeight: '600',
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
