// Design: /design/flows-split.jsx — SplitCreateScreen
// Spec: /specs/06_modules/split.md
// Wizard de 3 etapas: nome/tipo → valor/vagas → participantes (obrigatório
// preencher todas as vagas). Participantes ficam fixados na criação — não há
// convite por link nem etapa de compartilhar.

import { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useSplitStore, SplitType } from '../../../store/split.store'
import { useAuthStore } from '../../../store/auth.store'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { Eyebrow } from '../../../components/shared/Eyebrow'
import { formatAlbers } from '../../../utils/format'
import { maskAlbers, parseAlbers } from '../../../utils/currency'
import { colors, spaceSkins } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

// ─── Constants ────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 'participants'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

interface ParticipantResult {
  id:     string
  name:   string
  handle: string
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SplitCriarScreen() {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const token    = useAuthStore(s => s.token)
  const { draft, updateDraft, resetDraft, createSplit } = useSplitStore()

  const [step, setStep]                     = useState<Step>(1)
  const [valueStr, setValueStr]             = useState('')
  const [creating, setCreating]             = useState(false)
  const [createError, setCreateError]       = useState<string | null>(null)

  // Participantes (obrigatório preencher todas as vagas antes de criar)
  const [participantQuery, setParticipantQuery]     = useState('')
  const [participantSearching, setParticipantSearching] = useState(false)
  const [participantResults, setParticipantResults] = useState<ParticipantResult[]>([])
  const [selectedParticipants, setSelectedParticipants] = useState<ParticipantResult[]>([])

  useEffect(() => {
    resetDraft()
    setValueStr('')
    setSelectedParticipants([])
  }, [])

  useEffect(() => {
    const clean = participantQuery.trim()
    if (clean.length < 2 || !token) { setParticipantResults([]); return }
    setParticipantSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${BFF}/user-search?q=${encodeURIComponent(clean.replace('@', ''))}`,
          { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } },
        )
        const results = await res.json()
        setParticipantResults(Array.isArray(results) ? results : [])
      } catch {
        setParticipantResults([])
      } finally {
        setParticipantSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [participantQuery, token])

  // ── Computed ─────────────────────────────────────────────────────────────────

  const isFixed     = draft.type === 'fixed'
  const parsedValue = parseAlbers(valueStr)
  const perPerson   = draft.participantCount > 0
    ? Math.ceil(parsedValue / draft.participantCount)
    : 0

  const maxInvitable = Math.max(0, draft.participantCount - 1)
  const slotsFilled  = selectedParticipants.length === maxInvitable

  // ── Actions ───────────────────────────────────────────────────────────────────

  function goToStep2() {
    setStep(2)
  }

  function goToParticipants() {
    updateDraft({ totalValue: parsedValue })
    setStep('participants')
  }

  function addParticipant(p: ParticipantResult) {
    if (selectedParticipants.some(sp => sp.id === p.id)) return
    if (selectedParticipants.length >= maxInvitable) return
    setSelectedParticipants(prev => [...prev, p])
    setParticipantQuery('')
    setParticipantResults([])
  }

  function removeParticipant(id: string) {
    setSelectedParticipants(prev => prev.filter(p => p.id !== id))
  }

  async function handleCreate() {
    if (creating || !token || !slotsFilled) return
    updateDraft({ participantHandles: selectedParticipants.map(p => p.handle) })
    setCreating(true)
    setCreateError(null)
    try {
      const res = await createSplit(token)
      router.replace(`/(app)/split/${res.split_id}`)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t('split.criar.createError'))
      setCreating(false)
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
                  onPress={() => {
                    const nextCount = Math.max(2, draft.participantCount - 1)
                    updateDraft({ participantCount: nextCount })
                    setSelectedParticipants(prev => prev.slice(0, Math.max(0, nextCount - 1)))
                  }}
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
              onPress={goToParticipants}
              state={parsedValue > 0 ? 'default' : 'disabled'}
            />
          </View>
        </KeyboardAvoidingView>
      </WizardShell>
    )
  }

  // step === 'participants' — etapa final: seleção obrigatória + criar

  return (
    <WizardShell
      title={t('split.criar.title')}
      subtitle={t('split.criar.participantsStepLabel')}
      onBack={() => setStep(2)}
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
          <Eyebrow>{t('split.criar.participantsSearchLabel')}</Eyebrow>
          <TextInput
            style={styles.nameInput}
            value={participantQuery}
            onChangeText={setParticipantQuery}
            placeholder={t('split.criar.participantsSearchPlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.25)"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <Text style={styles.participantsHint}>
            {maxInvitable > 0
              ? t('split.criar.participantsSlotHint', { n: selectedParticipants.length, max: maxInvitable })
              : t('split.criar.participantsNoSlots')}
          </Text>

          {participantSearching && (
            <Text style={styles.participantsHint}>{t('split.criar.participantsSearching')}</Text>
          )}

          {participantResults.length > 0 && (
            <View style={styles.resultsList}>
              {participantResults.map(r => {
                const alreadySelected = selectedParticipants.some(sp => sp.id === r.id)
                const disabled = alreadySelected || selectedParticipants.length >= maxInvitable
                return (
                  <TouchableOpacity
                    key={r.id}
                    onPress={() => addParticipant(r)}
                    disabled={disabled}
                    style={[styles.resultRow, disabled && styles.resultRowDisabled]}
                    activeOpacity={0.7}
                  >
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{r.name}</Text>
                      <Text style={styles.resultHandle}>{r.handle}</Text>
                    </View>
                    <Text style={styles.resultAction}>
                      {alreadySelected ? t('split.criar.participantsAdded') : t('split.criar.participantsAddCta')}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}

          {selectedParticipants.length > 0 && (
            <View style={styles.selectedSection}>
              <Eyebrow>{t('split.criar.participantsSelectedLabel')}</Eyebrow>
              <View style={styles.chipsRow}>
                {selectedParticipants.map(p => (
                  <View key={p.id} style={styles.chip}>
                    <Text style={styles.chipText} numberOfLines={1}>{p.handle}</Text>
                    <TouchableOpacity onPress={() => removeParticipant(p.id)} hitSlop={8}>
                      <Text style={styles.chipRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.actionArea}>
          {createError && (
            <Text style={styles.createErrorText}>{createError}</Text>
          )}
          <PrimaryButton
            label={t('split.criar.createCta')}
            onPress={handleCreate}
            state={creating ? 'loading' : slotsFilled ? 'default' : 'disabled'}
          />
        </View>
      </KeyboardAvoidingView>
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

  // Step participants — Convidar
  participantsHint: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: spacing.sm,
  },
  resultsList: {
    marginTop: spacing.md,
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  resultRowDisabled: {
    opacity: 0.4,
  },
  resultInfo: { flex: 1 },
  resultName: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  resultHandle: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 1,
  },
  resultAction: {
    fontSize: 11.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: TEAL,
  },
  selectedSection: {
    marginTop: 24,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: TEAL_BG,
    borderWidth: 0.5,
    borderColor: TEAL_BORDER,
    maxWidth: 160,
  },
  chipText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    flexShrink: 1,
  },
  chipRemove: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  createErrorText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(239,68,68,0.9)',
    textAlign: 'center',
    marginBottom: 8,
  },
})
