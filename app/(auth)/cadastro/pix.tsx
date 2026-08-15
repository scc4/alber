// Design: /design/auth.jsx — StepPix
// Spec: /specs/06_modules/onboarding.md seção 3.8
// Spec: /specs/03_backend.md §4.1
// Escolha da chave Pix de saque pessoal — salva no draft e segue pra
// cadastro/terms.tsx, que é quem de fato chama auth-register.

import { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { Field } from '../../../components/core/Field'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { getDraft, updateDraft } from '../../../store/signup-draft'
import { validateCPF } from '../../../utils/cpf'
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

const PIX_TYPES: { id: PixType; labelKey: string }[] = [
  { id: 'cpf',    labelKey: 'auth.onboarding.pix.cpf' },
  { id: 'phone',  labelKey: 'auth.onboarding.pix.phone' },
  { id: 'email',  labelKey: 'auth.onboarding.pix.email' },
  { id: 'random', labelKey: 'auth.onboarding.pix.random' },
]

// ── Tela principal ────────────────────────────────────────────────────────────

export default function PixScreen() {
  const { t }        = useTranslation()
  const draft        = getDraft()
  // Master de empresa que optou por não ter carteira pessoal, ou operador
  // vindo de link de convite (plano CNPJ velvet-puzzling-sedgewick) — pula
  // toda a escolha de chave Pix de saque, já que não existe carteira pessoal
  // para sacar.
  const noPersonalWallet =
    (draft.accountType === 'business' && draft.wantsPersonalWallet === false) || !!draft.inviteToken

  const [pixType, setPixType]             = useState<PixType>(draft.pixType ?? 'cpf')
  const [pixKey, setPixKey]               = useState<string>(draft.pixKey || maskCPF(draft.cpf ?? ''))
  const [asaasDisclosed, setAsaasDisclosed] = useState(false)
  const [showAsaasModal, setShowAsaasModal] = useState(false)

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

  const cpfPixValid = pixType !== 'cpf' || validateCPF(pixKey)
  const isReady = noPersonalWallet
    ? asaasDisclosed
    : pixKey.trim().length > 0 && asaasDisclosed && cpfPixValid

  const handleNext = () => {
    if (!isReady) return
    if (!noPersonalWallet) {
      updateDraft({
        pixType,
        pixKey: pixType === 'cpf' ? pixKey.replace(/\D/g, '') : pixKey,
      })
    }
    router.push('/(auth)/cadastro/terms')
  }

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
          <Text style={styles.withdrawalHint}>{t('auth.onboarding.pix.albersExplainer')}</Text>

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
