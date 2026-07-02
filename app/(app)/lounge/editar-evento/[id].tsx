// Spec: /specs/06_modules/alber_lounge.md § 8.5 "Edição pós-publicação"
// Permite editar: nome, descrição, imagem, data/hora.
// NÃO permite alterar: is_paid, lotes, capacidade.

import { useState } from 'react'
import {
  Alert,
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
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useLoungeStore } from '../../../../store/lounge.store'
import { useAuthStore } from '../../../../store/auth.store'
import { pickFromGallery, uploadImage } from '../../../../services/storage.service'
import { Header } from '../../../../components/core/Header'
import { Eyebrow } from '../../../../components/shared/Eyebrow'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { DatePickerField, formatDateBR } from '../../../../components/shared/DatePickerField'
import { TimePickerField, formatTimeBR } from '../../../../components/shared/TimePickerField'
import { colors } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EditarEventoScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>()
  const { t }   = useTranslation()
  const insets  = useSafeAreaInsets()

  const getEventById = useLoungeStore(s => s.getEventById)
  const fetchLounge  = useLoungeStore(s => s.fetchLounge)
  const updateEvent  = useLoungeStore(s => s.updateEvent)
  const token        = useAuthStore(s => s.token)
  const user         = useAuthStore(s => s.user)

  const found = getEventById(id)
  const event  = found?.event
  const lounge = found?.lounge

  // ── Form state ────────────────────────────────────────────────────────────────

  const [name, setName]           = useState(event?.name ?? '')
  const [desc, setDesc]           = useState(event?.description ?? '')
  const [imageUri, setImageUri]   = useState<string | null>(null)
  const [dateObj, setDateObj]     = useState<Date | null>(
    event?.date ? new Date(event.date) : null
  )
  const [timeObj, setTimeObj]     = useState<Date | null>(
    event?.date ? new Date(event.date) : null
  )
  const [saving, setSaving]       = useState(false)

  // ── Early exits ──────────────────────────────────────────────────────────────

  if (!event || !lounge) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('lounge.editarEvento.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Evento não encontrado.</Text>
        </View>
      </View>
    )
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const combinedDate = (() => {
    if (!dateObj) return null
    const base = new Date(dateObj)
    if (timeObj) {
      base.setHours(timeObj.getHours(), timeObj.getMinutes(), 0, 0)
    }
    return base
  })()

  const nameChanged   = name.trim() !== event.name
  const descChanged   = desc !== (event.description ?? '')
  const imageChanged  = imageUri !== null
  const dateChanged   = combinedDate
    ? Math.abs(combinedDate.getTime() - new Date(event.date).getTime()) > 60_000
    : false
  const hasChanges = nameChanged || descChanged || imageChanged || dateChanged

  // ── Save ──────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!event || !lounge || !token || !user || !hasChanges || saving) return

    if (nameChanged && !name.trim()) {
      Alert.alert(t('lounge.editarEvento.title'), 'Nome não pode ser vazio.')
      return
    }

    setSaving(true)
    try {
      let finalImageUrl: string | null | undefined = undefined

      if (imageChanged && imageUri) {
        const uploaded = await uploadImage(
          imageUri,
          'event-images',
          `${event.id}/cover/${Date.now()}`,
          token,
        )
        if (!uploaded) {
          Alert.alert('Erro', 'Falha ao enviar imagem. Tente novamente.')
          setSaving(false)
          return
        }
        finalImageUrl = uploaded
      }

      const patch: Record<string, unknown> = {}
      if (nameChanged)                 patch.name        = name.trim()
      if (descChanged)                 patch.description = desc
      if (finalImageUrl !== undefined) patch.image_url   = finalImageUrl
      if (dateChanged && combinedDate) patch.date        = combinedDate.toISOString()

      await updateEvent(event.id, patch, token)
      await fetchLounge(lounge.id, user.id, token)
      router.back()
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? t('lounge.editarEvento.saveError'))
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={t('lounge.editarEvento.title')}
        contextLabel={lounge.name}
        onBack={() => router.back()}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom + 100, spacing.xl + 80) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <Eyebrow>{t('lounge.editarEvento.nameLabel')}</Eyebrow>
          <View style={styles.fieldWrap}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={v => setName(v.slice(0, 80))}
              placeholder={event.name}
              placeholderTextColor="rgba(255,255,255,0.25)"
              maxLength={80}
              returnKeyType="done"
            />
            <Text style={styles.counter}>{name.length}/80</Text>
          </View>

          {/* Description */}
          <View style={styles.sectionGap}>
            <Eyebrow>{t('lounge.editarEvento.descLabel')}</Eyebrow>
          </View>
          <View style={styles.fieldWrap}>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={desc}
              onChangeText={v => setDesc(v.slice(0, 500))}
              placeholder={t('lounge.editarEvento.descPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.25)"
              maxLength={500}
              multiline
              textAlignVertical="top"
            />
            <Text style={[styles.counter, styles.counterMultiline]}>{desc.length}/500</Text>
          </View>

          {/* Image */}
          <View style={styles.sectionGap}>
            <Eyebrow>{t('lounge.editarEvento.imageLabel')}</Eyebrow>
          </View>
          <TouchableOpacity
            style={styles.imageUpload}
            activeOpacity={0.7}
            onPress={async () => {
              const uri = await pickFromGallery()
              if (uri) setImageUri(uri)
            }}
          >
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.imagePreview} resizeMode="cover" />
            ) : event.imageUri ? (
              <Image source={{ uri: event.imageUri }} style={styles.imagePreview} resizeMode="cover" />
            ) : (
              <>
                <Text style={styles.imageUploadTitle}>{t('lounge.editarEvento.imageHint')}</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Date */}
          <View style={styles.sectionGap}>
            <Eyebrow>{t('lounge.editarEvento.dateLabel')}</Eyebrow>
          </View>
          <DatePickerField
            label={dateObj ? formatDateBR(dateObj) : ''}
            placeholder="dd/mm/aaaa"
            value={dateObj}
            onChange={(d) => setDateObj(d)}
            minimumDate={new Date()}
          />

          {/* Time */}
          <View style={styles.sectionGap}>
            <Eyebrow>{t('lounge.editarEvento.timeLabel')}</Eyebrow>
          </View>
          <TimePickerField
            label={timeObj ? formatTimeBR(timeObj) : ''}
            placeholder="hh:mm"
            value={timeObj}
            onChange={(d) => setTimeObj(d)}
          />
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <PrimaryButton
            label={t('lounge.editarEvento.saveCta')}
            onPress={handleSave}
            state={saving ? 'loading' : !hasChanges ? 'disabled' : 'default'}
          />
        </View>
      </KeyboardAvoidingView>
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
  },
  sectionGap: { marginTop: 24 },

  fieldWrap: { position: 'relative', marginTop: 10 },
  input: {
    padding: 13,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    paddingRight: 50,
  },
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingRight: 13,
    paddingBottom: 28,
  },
  counter: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.25)',
  },
  counterMultiline: {
    bottom: 8,
    right: 10,
  },

  imageUpload: {
    marginTop: 10,
    height: 160,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imageUploadTitle: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
  },

  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.black[100],
  },

  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
  },
})
