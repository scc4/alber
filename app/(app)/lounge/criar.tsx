// Design: /design/flows-rest.jsx — LoungeCreateScreen
// Spec: /specs/06_modules/alber_lounge.md § 4 "Criar Lounge"
// Wizard 3 etapas: nome/descrição → tipo → preview/cor/capa

import { useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
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
import { useAuthStore } from '../../../store/auth.store'
import { useLoungeStore } from '../../../store/lounge.store'
import { pickFromGallery, uploadImage } from '../../../services/storage.service'
import { Header } from '../../../components/core/Header'
import { Eyebrow } from '../../../components/shared/Eyebrow'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { colors } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

// ─── Constants ────────────────────────────────────────────────────────────────

const PALETTE = ['#5BCEC9', '#C9B06A', '#E07D7D', '#7DA3E0', '#B58FE0', '#7AB87A', '#E0B05B', '#9B6B82']

type Step       = 1 | 2 | 3
type Visibility = 'public' | 'private'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LoungeCreateScreen() {
  const { t }   = useTranslation()
  const insets  = useSafeAreaInsets()

  const token                  = useAuthStore(s => s.token)
  const userId                 = useAuthStore(s => s.user?.id ?? '')
  const createLounge           = useLoungeStore(s => s.createLounge)
  const fetchLounge            = useLoungeStore(s => s.fetchLounge)
  const hasActiveLoungeAsOwner = useLoungeStore(s => s.hasActiveLoungeAsOwner)

  const [step, setStep]             = useState<Step>(1)
  const [name, setName]             = useState('')
  const [desc, setDesc]             = useState('')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [accent, setAccent]         = useState(PALETTE[0])
  const [imageUri, setImageUri]       = useState<string | null>(null)
  const [creating, setCreating]       = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const isOwner = hasActiveLoungeAsOwner()

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!token || !userId) return
    setCreating(true)
    setCreateError(null)
    try {
      const uploadedUrl = imageUri
        ? await uploadImage(imageUri, 'lounge-images', `${userId}/${Date.now()}`, token)
        : null
      const res = await createLounge({
        name:        name.trim(),
        description: desc.trim(),
        visibility,
        accent,
        imageUri:    uploadedUrl,
      }, token)
      await fetchLounge(res.space_id, userId, token)
      router.replace(`/(app)/lounge/${res.space_id}`)
    } catch (e: any) {
      setCreateError(e?.message ?? 'Erro ao criar Lounge')
      setCreating(false)
    }
  }

  // ── Step 1: Nome e descrição ─────────────────────────────────────────────────

  if (step === 1) {
    return (
      <View style={styles.root}>
        <Header
          variant="title"
          title={t('lounge.criar.title')}
          contextLabel={t('lounge.criar.step1Label')}
          onBack={() => router.back()}
        />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Disabled banner */}
            {isOwner && (
              <View style={styles.disabledBanner}>
                <Text style={styles.disabledBannerText}>{t('lounge.createDisabledTooltip')}</Text>
              </View>
            )}

            <Eyebrow>{t('lounge.criar.nameLabel')}</Eyebrow>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={v => setName(v.slice(0, 40))}
              placeholder={t('lounge.criar.namePlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.25)"
              maxLength={40}
              autoFocus={!isOwner}
              editable={!isOwner}
              returnKeyType="next"
            />
            <Text style={styles.counter}>{t('lounge.criar.nameCounter', { n: name.length })}</Text>

            <View style={styles.fieldGap}>
              <Eyebrow>{t('lounge.criar.descLabel')}</Eyebrow>
              <TextInput
                style={styles.descInput}
                value={desc}
                onChangeText={v => setDesc(v.slice(0, 240))}
                placeholder={t('lounge.criar.descPlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.25)"
                maxLength={240}
                multiline
                editable={!isOwner}
                textAlignVertical="top"
              />
              <Text style={styles.counter}>{t('lounge.criar.descCounter', { n: desc.length })}</Text>
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <PrimaryButton
              label={t('lounge.criar.continue')}
              onPress={() => setStep(2)}
              state={isOwner || name.trim().length < 3 ? 'disabled' : 'default'}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    )
  }

  // ── Step 2: Tipo ─────────────────────────────────────────────────────────────

  if (step === 2) {
    const OPTIONS: { id: Visibility; label: string; desc: string }[] = [
      { id: 'public',  label: t('lounge.criar.typePublic'),  desc: t('lounge.criar.typePublicDesc') },
      { id: 'private', label: t('lounge.criar.typePrivate'), desc: t('lounge.criar.typePrivateDesc') },
    ]

    return (
      <View style={styles.root}>
        <Header
          variant="title"
          title={t('lounge.criar.title')}
          contextLabel={t('lounge.criar.step2Label')}
          onBack={() => setStep(1)}
        />

        <View style={styles.flex}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Eyebrow>{t('lounge.criar.typeLabel')}</Eyebrow>
            <View style={styles.optionsGap}>
              {OPTIONS.map(opt => {
                const selected = visibility === opt.id
                return (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => setVisibility(opt.id)}
                    activeOpacity={0.8}
                    style={[styles.optionCard, selected && styles.optionCardSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.optionTop}>
                      <View style={[styles.radio, selected && styles.radioSelected]}>
                        {selected && <View style={styles.radioDot} />}
                      </View>
                      <Text style={styles.optionLabel}>{opt.label}</Text>
                    </View>
                    <Text style={styles.optionDesc}>{opt.desc}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <PrimaryButton
              label={t('lounge.criar.continue')}
              onPress={() => setStep(3)}
            />
          </View>
        </View>
      </View>
    )
  }

  // ── Step 3: Preview, cor e capa ──────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={t('lounge.criar.title')}
        contextLabel={t('lounge.criar.step3Label')}
        onBack={() => setStep(2)}
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 80, spacing.xl) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Preview card */}
        <Eyebrow>{t('lounge.criar.previewLabel')}</Eyebrow>
        <View style={[styles.previewCard, { borderColor: `${accent}33`, backgroundColor: `${accent}08` }]}>
          <View style={[styles.previewGlow, { backgroundColor: `${accent}20` }]} pointerEvents="none" />
          <View style={styles.previewContent}>
            <View style={styles.previewBadgeRow}>
              <View style={[styles.previewDot, { backgroundColor: accent }]} />
              <View style={[styles.previewBadge, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
                <Text style={[styles.previewBadgeText, { color: accent }]}>{t('lounge.roleOwner')}</Text>
              </View>
            </View>
            <Text style={styles.previewName}>{name.trim() || 'Nome do Lounge'}</Text>
            <Text style={styles.previewMeta}>
              {'1 membro · '}
              {visibility === 'public' ? t('lounge.criar.visPublicBadge') : t('lounge.criar.visPrivateBadge')}
            </Text>
          </View>
        </View>

        {/* Accent color */}
        <View style={styles.fieldGap}>
          <Eyebrow>{t('lounge.criar.accentLabel')}</Eyebrow>
          <View style={styles.palette}>
            {PALETTE.map(c => (
              <TouchableOpacity
                key={c}
                onPress={() => setAccent(c)}
                activeOpacity={0.8}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  accent === c && styles.swatchSelected,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: accent === c }}
                accessibilityLabel={c}
              />
            ))}
          </View>
        </View>

        {/* Cover image */}
        <View style={styles.fieldGap}>
          <Eyebrow>{t('lounge.criar.coverLabel')}</Eyebrow>
          <TouchableOpacity
            style={styles.coverUpload}
            activeOpacity={0.7}
            onPress={async () => {
              const uri = await pickFromGallery()
              if (uri) setImageUri(uri)
            }}
          >
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.coverPreview} resizeMode="cover" />
            ) : (
              <Text style={styles.coverUploadText}>{t('lounge.criar.coverHint')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Hint */}
        <View style={[styles.hintCard, { backgroundColor: `${accent}10`, borderColor: `${accent}30` }]}>
          <Text style={[styles.hintText, { color: `${accent}cc` }]}>{t('lounge.criar.previewHint')}</Text>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {createError && (
          <Text style={styles.createError}>{createError}</Text>
        )}
        <PrimaryButton
          label={t('lounge.criar.createCta')}
          onPress={handleCreate}
          state={creating ? 'loading' : 'default'}
        />
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },

  // Step 1
  disabledBanner: {
    padding: 12,
    backgroundColor: 'rgba(239,68,68,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 10,
    marginBottom: spacing.md,
  },
  disabledBannerText: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(239,68,68,0.85)',
    lineHeight: 18,
  },
  nameInput: {
    marginTop: 8,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.18)',
    fontSize: 20,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -20 * 0.01,
  },
  counter: {
    marginTop: 6,
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'right',
  },
  fieldGap: {
    marginTop: 28,
  },
  descInput: {
    marginTop: 8,
    padding: 12,
    minHeight: 96,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    lineHeight: 21,
  },

  // Step 2
  optionsGap: {
    marginTop: 14,
    gap: 10,
  },
  optionCard: {
    padding: 16,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  optionCardSelected: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  optionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 5,
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
    borderRadius: 5,
    backgroundColor: colors.white[100],
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  optionDesc: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 18,
    marginLeft: 28,
  },

  // Step 3 — preview
  previewCard: {
    marginTop: 12,
    height: 160,
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'flex-end',
  },
  previewGlow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  previewContent: {
    padding: 16,
  },
  previewBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  },
  previewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 0.5,
  },
  previewBadgeText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 9 * 0.14,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  previewName: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -22 * 0.02,
  },
  previewMeta: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
  },

  // Color palette
  palette: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  swatchSelected: {
    borderColor: colors.white[100],
    transform: [{ scale: 1.08 }],
  },

  // Cover upload
  coverUpload: {
    marginTop: 10,
    padding: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    alignItems: 'center',
  },
  coverUploadText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },
  coverPreview: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },

  // Hint
  hintCard: {
    marginTop: 14,
    padding: 12,
    borderWidth: 0.5,
    borderRadius: 10,
  },
  hintText: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    lineHeight: 17,
  },

  createError: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(239,68,68,0.9)',
    textAlign: 'center',
    marginBottom: 8,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.black[100],
  },
})
