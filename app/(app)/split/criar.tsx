// Design: /design/flows-split.jsx — SplitCreateScreen
// Spec: /specs/06_modules/split.md
// Wizard de 3 etapas + tela de compartilhar.

import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useSplitStore, SplitType, LinkValidity } from '../../../store/split.store'
import { useAuthStore } from '../../../store/auth.store'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { Eyebrow } from '../../../components/shared/Eyebrow'
import { formatAlbers } from '../../../utils/format'
import { maskAlbers, parseAlbers } from '../../../utils/currency'
import { colors, spaceSkins } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

// ─── Constants ────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 'share'

const MOCK_CONTACTS = [
  { name: 'João S.',  handle: '@joaosilva' },
  { name: 'Ana C.',   handle: '@ana_costa' },
  { name: 'Pedro',    handle: '@phenrique' },
  { name: 'Cami',     handle: '@cami' },
  { name: 'Lucas',    handle: '@lucasm' },
]

const VALIDITY_OPTIONS: { id: LinkValidity; key: string }[] = [
  { id: '1h',     key: 'split.criar.validity1h'     },
  { id: '24h',    key: 'split.criar.validity24h'    },
  { id: '7d',     key: 'split.criar.validity7d'     },
  { id: 'custom', key: 'split.criar.validityCustom' },
]

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SplitCriarScreen() {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const token    = useAuthStore(s => s.token)
  const { draft, updateDraft, resetDraft, createSplit, setActiveSplitId } = useSplitStore()

  const [step, setStep]                     = useState<Step>(1)
  const [valueStr, setValueStr]             = useState('')
  const [customDays, setCustomDays]         = useState(7)
  const [createdId, setCreatedId]           = useState<string | null>(null)
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null)
  const [creating, setCreating]             = useState(false)
  const [copied, setCopied]                 = useState(false)
  const copiedTimer                         = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    resetDraft()
    setValueStr('')
  }, [])

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  // ── Computed ─────────────────────────────────────────────────────────────────

  const isFixed     = draft.type === 'fixed'
  const parsedValue = parseAlbers(valueStr)
  const perPerson   = draft.participantCount > 0
    ? Math.ceil(parsedValue / draft.participantCount)
    : 0

  // ── Actions ───────────────────────────────────────────────────────────────────

  function goToStep2() {
    setStep(2)
  }

  function goToStep3() {
    updateDraft({ totalValue: parsedValue })
    setStep(3)
  }

  async function handleCreate() {
    if (!token) return
    const expiry = draft.linkValidity === 'custom'
      ? new Date(Date.now() + customDays * 86_400_000).toISOString()
      : null
    updateDraft({ totalValue: parsedValue, customExpiry: expiry })
    setCreating(true)
    try {
      const res = await createSplit(token)
      setCreatedId(res.split_id)
      setCreatedInviteUrl(res.invite_url)
      setStep('share')
    } catch {
      // error já gravado no store — o usuário vê via error state
    } finally {
      setCreating(false)
    }
  }

  function handleDone() {
    if (createdId) {
      setActiveSplitId(createdId)
      router.replace(`/(app)/split/${createdId}`)
    } else {
      router.back()
    }
  }

  async function handleCopy() {
    if (!createdInviteUrl) return
    try {
      await Share.share({ message: createdInviteUrl })
    } catch {
      /* ignore */
    }
    setCopied(true)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  async function handleShare() {
    if (!createdInviteUrl) return
    try {
      await Share.share({ message: createdInviteUrl, title: draft.name })
    } catch {
      /* ignore */
    }
  }

  // ── Render steps ─────────────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <WizardShell
        title={t('split.criar.title')}
        subtitle={t('split.criar.step1Label')}
        onClose={() => router.back()}
        insets={insets}
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.stepContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Name */}
            <Eyebrow>{t('split.criar.nameLabel')}</Eyebrow>
            <TextInput
              style={styles.nameInput}
              value={draft.name}
              onChangeText={v => updateDraft({ name: v })}
              placeholder={t('split.criar.namePlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.25)"
              autoFocus
              returnKeyType="next"
            />

            {/* Type */}
            <View style={styles.typeSection}>
              <Eyebrow>{t('split.criar.typeLabel')}</Eyebrow>
              <View style={styles.typeList}>
                {([
                  { id: 'fixed'    as SplitType, labelKey: 'split.typeLabelFixed',    descKey: 'split.typeDescFixed'    },
                  { id: 'variable' as SplitType, labelKey: 'split.typeLabelVariable', descKey: 'split.typeDescVariable' },
                ] as const).map(opt => {
                  const selected = draft.type === opt.id
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      onPress={() => updateDraft({ type: opt.id })}
                      style={[styles.typeCard, selected && styles.typeCardSelected]}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.typeCardTitle}>{t(opt.labelKey)}</Text>
                      <Text style={styles.typeCardDesc}>{t(opt.descKey)}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          </ScrollView>

          <View style={styles.actionArea}>
            <PrimaryButton
              label={t('split.criar.continue')}
              onPress={goToStep2}
              state={draft.name.trim() && draft.type ? 'default' : 'disabled'}
            />
          </View>
        </KeyboardAvoidingView>
      </WizardShell>
    )
  }

  if (step === 2) {
    return (
      <WizardShell
        title={t('split.criar.title')}
        subtitle={t('split.criar.step2Label')}
        onBack={() => setStep(1)}
        onClose={() => router.back()}
        insets={insets}
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.stepContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Value */}
            <Eyebrow>{t(isFixed ? 'split.criar.totalLabel' : 'split.criar.targetLabel')}</Eyebrow>
            <View style={styles.valueRow}>
              <TextInput
                style={styles.bigInput}
                value={valueStr}
                onChangeText={v => setValueStr(maskAlbers(v))}
                keyboardType="number-pad"
                placeholder="0,00"
                placeholderTextColor="rgba(255,255,255,0.2)"
                autoFocus
              />
              <Text style={styles.bigUnit}>{t('split.criar.amountUnit')}</Text>
            </View>

            {/* Participant count */}
            <View style={styles.participantsSection}>
              <Eyebrow>{t('split.criar.participantsLabel')}</Eyebrow>
              <View style={styles.stepper}>
                <TouchableOpacity
                  onPress={() => updateDraft({ participantCount: Math.max(2, draft.participantCount - 1) })}
                  style={styles.stepBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepCount}>{draft.participantCount}</Text>
                <TouchableOpacity
                  onPress={() => updateDraft({ participantCount: draft.participantCount + 1 })}
                  style={styles.stepBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Per-person preview */}
            {parsedValue > 0 && (
              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>
                  {t(isFixed ? 'split.criar.eachPaysLabel' : 'split.criar.eachBlocksLabel')}
                </Text>
                <View style={styles.previewValue}>
                  <Text style={styles.previewNumber}>{formatAlbers(perPerson)}</Text>
                  <Text style={styles.previewUnit}> {t('split.criar.amountUnit')}</Text>
                </View>
                {!isFixed && (
                  <Text style={styles.variableWarning}>{t('split.criar.variableWarning')}</Text>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.actionArea}>
            <PrimaryButton
              label={t('split.criar.continue')}
              onPress={goToStep3}
              state={parsedValue > 0 ? 'default' : 'disabled'}
            />
          </View>
        </KeyboardAvoidingView>
      </WizardShell>
    )
  }

  if (step === 3) {
    return (
      <WizardShell
        title={t('split.criar.validityLabel')}
        subtitle={t('split.criar.step3Label')}
        onBack={() => setStep(2)}
        onClose={() => router.back()}
        insets={insets}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.stepContent}
        >
          {VALIDITY_OPTIONS.map(opt => {
            const selected = draft.linkValidity === opt.id
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => updateDraft({ linkValidity: opt.id })}
                style={[styles.validityCard, selected && styles.validityCardSelected]}
                activeOpacity={0.75}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.validityLabel}>{t(opt.key)}</Text>
              </TouchableOpacity>
            )
          })}

          {/* Custom days stepper */}
          {draft.linkValidity === 'custom' && (
            <View style={styles.customStepper}>
              <TouchableOpacity
                onPress={() => setCustomDays(d => Math.max(1, d - 1))}
                style={styles.stepBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.customDaysText}>
                {customDays} {t('split.criar.customDaysUnit')}
              </Text>
              <TouchableOpacity
                onPress={() => setCustomDays(d => Math.min(90, d + 1))}
                style={styles.stepBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        <View style={styles.actionArea}>
          <PrimaryButton
            label={t('split.criar.createCta')}
            onPress={handleCreate}
            state={creating ? 'loading' : 'default'}
          />
        </View>
      </WizardShell>
    )
  }

  // ── Share screen ─────────────────────────────────────────────────────────────

  const shareSummary = createdId
    ? isFixed
      ? t('split.criar.shareSummaryFixed', {
          perPerson: formatAlbers(perPerson),
          count: draft.participantCount,
        })
      : t('split.criar.shareSummaryVariable', {
          blockPer: formatAlbers(perPerson),
          count: draft.participantCount,
        })
    : ''

  return (
    <WizardShell
      title={t('split.criar.shareLabel')}
      subtitle={draft.name}
      onClose={() => router.back()}
      insets={insets}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.stepContent, { paddingBottom: 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Created confirmation */}
        <View style={styles.createdBox}>
          <Text style={styles.createdLabel}>{t('split.criar.shareCreatedLabel')}</Text>
          <Text style={styles.createdName}>{draft.name}</Text>
          <Text style={styles.createdSummary}>{shareSummary}</Text>
        </View>

        {/* Invite link */}
        <View style={styles.linkBox}>
          <Text style={styles.linkLabel}>{t('split.criar.shareLinkLabel')}</Text>
          <Text style={styles.linkText} numberOfLines={2} selectable>
            {createdInviteUrl ?? '—'}
          </Text>
        </View>

        {/* Copy + Share */}
        <View style={styles.linkActions}>
          <TouchableOpacity onPress={handleCopy} style={styles.ghostBtn} activeOpacity={0.75}>
            <Text style={styles.ghostBtnText}>
              {copied ? '✓ ' : ''}{t('split.criar.shareCopyCta')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={styles.ghostBtn} activeOpacity={0.75}>
            <Text style={styles.ghostBtnText}>{t('split.criar.shareShareCta')}</Text>
          </TouchableOpacity>
        </View>

        {/* Alber contacts */}
        <View style={styles.contactsHeader}>
          <Eyebrow>{t('split.criar.shareContactsLabel')}</Eyebrow>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.contactsRow}
        >
          {MOCK_CONTACTS.map(c => (
            <View key={c.handle} style={styles.contactItem}>
              <View style={[styles.contactAvatar, { backgroundColor: avatarHue(c.handle) }]}>
                <Text style={styles.contactInitial}>{c.name[0]}</Text>
              </View>
              <Text style={styles.contactName} numberOfLines={1}>{c.name}</Text>
            </View>
          ))}
        </ScrollView>
      </ScrollView>

      <View style={styles.actionArea}>
        <PrimaryButton
          label={t('split.criar.shareConcludeCta')}
          onPress={handleDone}
        />
      </View>
    </WizardShell>
  )
}

// ─── WizardShell ──────────────────────────────────────────────────────────────

function WizardShell({
  title,
  subtitle,
  onBack,
  onClose,
  insets,
  children,
}: {
  title: string
  subtitle: string
  onBack?: () => void
  onClose: () => void
  insets: ReturnType<typeof useSafeAreaInsets>
  children: React.ReactNode
}) {
  return (
    <View style={[styles.shell, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.shellHeader}>
        <Pressable
          onPress={onBack ?? onClose}
          hitSlop={8}
          style={styles.shellBackBtn}
          accessibilityRole="button"
        >
          <Text style={styles.shellBackText}>{onBack ? '‹' : '✕'}</Text>
        </Pressable>
        <View style={styles.shellTitleBlock}>
          <Text style={styles.shellTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.shellSubtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
      </View>

      {children}
    </View>
  )
}

// ─── Avatar hue helper ────────────────────────────────────────────────────────

function avatarHue(handle: string): string {
  const h = ((handle.charCodeAt(1) ?? 65) * 23) % 360
  return `hsl(${h}, 18%, 22%)`
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const TEAL        = spaceSkins.surf.accent
const TEAL_BG     = 'rgba(91,206,201,0.06)'
const TEAL_BORDER = 'rgba(91,206,201,0.18)'

const styles = StyleSheet.create({
  flex: { flex: 1 },

  // Shell
  shell: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    minHeight: spacing.headerHeight,
    gap: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  shellBackBtn: {
    width: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -8,
  },
  shellBackText: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 30,
  },
  shellTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  shellTitle: {
    fontSize: 17,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -0.255,
  },
  shellSubtitle: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },

  // Step content
  stepContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  actionArea: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },

  // Step 1 — Name
  nameInput: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 10,
    marginTop: spacing.sm,
    fontSize: 18,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  typeSection: {
    marginTop: 28,
  },
  typeList: {
    marginTop: 12,
    gap: 10,
  },
  typeCard: {
    padding: 14,
    borderRadius: spacing.radius.md,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  typeCardSelected: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  typeCardTitle: {
    fontSize: 14.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    marginBottom: 3,
  },
  typeCardDesc: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 16.8,
  },

  // Step 2 — Value
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 10,
    marginBottom: 18,
  },
  bigInput: {
    flex: 1,
    fontSize: 42,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -42 * 0.04,
    padding: 0,
    minWidth: 0,
  },
  bigUnit: {
    fontSize: 15,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
  },
  participantsSection: {
    marginTop: 8,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
  },
  stepBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 20,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  stepCount: {
    flex: 1,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
  },
  previewBox: {
    marginTop: 24,
    padding: 14,
    backgroundColor: TEAL_BG,
    borderWidth: 0.5,
    borderColor: TEAL_BORDER,
    borderRadius: 10,
    gap: 4,
  },
  previewLabel: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(91,206,201,0.7)',
    letterSpacing: 11 * 0.1,
    textTransform: 'uppercase',
  },
  previewValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  previewNumber: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: TEAL,
    letterSpacing: -24 * 0.02,
  },
  previewUnit: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(91,206,201,0.6)',
  },
  variableWarning: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 15,
    marginTop: 2,
  },

  // Step 3 — Validity
  validityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: spacing.radius.md,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: spacing.sm,
  },
  validityCardSelected: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.25)',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.3,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioSelected: {
    borderColor: colors.white[100],
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.white[100],
  },
  validityLabel: {
    fontSize: 14.5,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  customStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: TEAL_BG,
    borderWidth: 0.5,
    borderColor: TEAL_BORDER,
    borderRadius: spacing.radius.md,
    marginTop: -4,
    marginBottom: spacing.md,
  },
  customDaysText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: TEAL,
    fontVariant: ['tabular-nums'],
  },

  // Share screen
  createdBox: {
    marginTop: 14,
    padding: 18,
    backgroundColor: TEAL_BG,
    borderWidth: 0.5,
    borderColor: TEAL_BORDER,
    borderRadius: spacing.radius.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  createdLabel: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(91,206,201,0.7)',
    letterSpacing: 11 * 0.1,
    textTransform: 'uppercase',
  },
  createdName: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  createdSummary: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  linkBox: {
    marginTop: spacing.lg,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: spacing.radius.md,
    gap: 6,
  },
  linkLabel: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 10.5 * 0.14,
    textTransform: 'uppercase',
  },
  linkText: {
    fontSize: 12.5,
    fontFamily: 'monospace',
    color: colors.white[100],
  },
  linkActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 14,
  },
  ghostBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: {
    fontSize: 12.5,
    fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.85)',
  },
  contactsHeader: {
    marginTop: spacing.lg,
    marginBottom: 12,
  },
  contactsRow: {
    gap: 14,
    paddingBottom: spacing.sm,
  },
  contactItem: {
    alignItems: 'center',
    gap: 6,
    minWidth: 54,
  },
  contactAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInitial: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  contactName: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
})
