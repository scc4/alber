// Design: /design/flows-rest.jsx — EventCreateScreen
// Spec: /specs/06_modules/alber_lounge.md § 9.1 "Criar evento"
// Wizard 3 etapas: informações → tipo/lotes/visibilidade → revisão

import { useState } from 'react'
import {
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
import type { LoungeEvent, EventBatch } from '../../../../components/lounge/EventCard'
import { Header } from '../../../../components/core/Header'
import { Eyebrow } from '../../../../components/shared/Eyebrow'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { DatePickerField, formatDateBR } from '../../../../components/shared/DatePickerField'
import { TimePickerField, formatTimeBR } from '../../../../components/shared/TimePickerField'
import { colors } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step       = 1 | 2 | 3
type EventType  = 'free' | 'paid'
type Visibility = 'members_only' | 'public'
type Recurrence = 'none' | 'recurring'
type FreqOption = 'weekly' | 'biweekly' | 'monthly'

interface BatchDraft {
  name:   string
  priceR: string
  qty:    string
  until:  string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tomorrow(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(0, 0, 0, 0)
  return d
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CriarEventoScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>()
  const { t }   = useTranslation()
  const insets  = useSafeAreaInsets()

  const getLoungeById = useLoungeStore(s => s.getLoungeById)
  const createEvent   = useLoungeStore(s => s.createEvent)

  const lounge = getLoungeById(id)

  // ── Form state ────────────────────────────────────────────────────────────────

  const [step, setStep]               = useState<Step>(1)
  const [name, setName]               = useState('')
  const [desc, setDesc]               = useState('')
  const [dateObj, setDateObj]         = useState<Date | null>(null)
  const [timeObj, setTimeObj]         = useState<Date | null>(null)
  const date = dateObj ? formatDateBR(dateObj) : ''
  const time = timeObj ? formatTimeBR(timeObj) : ''
  const [capacity, setCapacity]       = useState('')
  const [recurrence, setRecurrence]   = useState<Recurrence>('none')
  const [freq, setFreq]               = useState<FreqOption>('monthly')
  const [eventType, setEventType]     = useState<EventType>('free')
  const [visibility, setVisibility]   = useState<Visibility>('members_only')
  const [batches, setBatches]         = useState<BatchDraft[]>([
    { name: '1º Lote', priceR: '', qty: '', until: '' },
  ])
  const [batchUntilDates, setBatchUntilDates] = useState<(Date | null)[]>([null])

  // ── Derived ───────────────────────────────────────────────────────────────────

  const totalBatchCap = batches.reduce((s, b) => s + (parseInt(b.qty) || 0), 0)
  const effectiveCap  = eventType === 'paid' ? totalBatchCap : (parseInt(capacity) || 0)

  // ── Batch helpers ─────────────────────────────────────────────────────────────

  function updateBatch(i: number, key: keyof BatchDraft, value: string) {
    setBatches(bs => bs.map((b, j) => j === i ? { ...b, [key]: value } : b))
  }

  function addBatch() {
    setBatches(bs => [...bs, { name: `${bs.length + 1}º Lote`, priceR: '', qty: '', until: '' }])
    setBatchUntilDates(ds => [...ds, null])
  }

  function removeBatch(i: number) {
    setBatches(bs => bs.filter((_, j) => j !== i))
    setBatchUntilDates(ds => ds.filter((_, j) => j !== i))
  }

  function setBatchUntilDate(i: number, d: Date) {
    setBatchUntilDates(ds => ds.map((v, j) => j === i ? d : v))
    updateBatch(i, 'until', formatDateBR(d))
  }

  // ── Publish ───────────────────────────────────────────────────────────────────

  function handlePublish() {
    if (!lounge) return

    const eventBatches: EventBatch[] = eventType === 'paid'
      ? batches.map((b, i) => ({
          id:          `batch-${Date.now()}-${i}`,
          name:        b.name,
          batchNumber: i + 1,
          batchType:   b.until ? 'date' : 'quantity',
          priceBrl:    parseFloat(b.priceR) || 0,
          priceAlbers: parseFloat(b.priceR) || 0,
          capacity:    parseInt(b.qty) || 0,
          sold:        0,
          validUntil:  b.until || null,
          status:      i === 0 ? 'active' : 'pending',
        }))
      : []

    const event: LoungeEvent = {
      id:             `ev-${Date.now()}`,
      loungeId:       lounge.id,
      name:           name.trim(),
      description:    desc.trim(),
      imageUri:       null,
      date:           `${date}${time ? ` · ${time}` : ''}`,
      visibility,
      isPaid:         eventType === 'paid',
      isRecurring:    recurrence === 'recurring',
      recurrenceFreq: recurrence === 'recurring' ? freq : null,
      batches:        eventBatches,
      totalCapacity:  effectiveCap,
      confirmed:      0,
      status:         'active',
      createdAt:      new Date().toISOString(),
    }

    createEvent(lounge.id, event)
    router.replace(`/(app)/lounge/${lounge.id}`)
  }

  // ── Not found ─────────────────────────────────────────────────────────────────

  if (!lounge) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('lounge.criarEvento.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Lounge não encontrado.</Text>
        </View>
      </View>
    )
  }

  const accent = lounge.accent

  // ── Step 1: Informações básicas ───────────────────────────────────────────────

  if (step === 1) {
    const canContinue = name.trim().length >= 2 && (date !== '' || capacity !== '')
    return (
      <View style={styles.root}>
        <Header
          variant="title"
          title={t('lounge.criarEvento.title')}
          contextLabel={t('lounge.criarEvento.step1Label')}
          onBack={() => router.back()}
        />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Name */}
            <Eyebrow>{t('lounge.criarEvento.nameLabel')}</Eyebrow>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder={t('lounge.criarEvento.namePlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.25)"
              autoFocus
              returnKeyType="next"
            />

            {/* Description */}
            <View style={styles.fieldGap}>
              <Eyebrow>{t('lounge.criarEvento.descLabel')}</Eyebrow>
              <TextInput
                style={styles.descInput}
                value={desc}
                onChangeText={setDesc}
                placeholder={t('lounge.criarEvento.descPlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.25)"
                multiline
                textAlignVertical="top"
              />
            </View>

            {/* Date + Time */}
            <View style={[styles.fieldGap, styles.row, { gap: 16 }]}>
              <View style={styles.flex}>
                <DatePickerField
                  label={t('lounge.criarEvento.dateLabel')}
                  value={dateObj}
                  onChange={setDateObj}
                  minimumDate={tomorrow()}
                  placeholder="DD/MM/AAAA"
                />
              </View>
              <View style={styles.flex}>
                <TimePickerField
                  label={t('lounge.criarEvento.timeLabel')}
                  value={timeObj}
                  onChange={setTimeObj}
                  placeholder="HH:MM"
                  minuteInterval={5}
                />
              </View>
            </View>

            {/* Capacity */}
            <View style={styles.fieldGap}>
              <Eyebrow>{t('lounge.criarEvento.capacityLabel')}</Eyebrow>
              <TextInput
                style={styles.nameInput}
                value={capacity}
                onChangeText={v => setCapacity(v.replace(/[^\d]/g, ''))}
                placeholder={t('lounge.criarEvento.capacityPlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.25)"
                keyboardType="numeric"
              />
              <Text style={styles.fieldHint}>{t('lounge.criarEvento.capacityHint')}</Text>
            </View>

            {/* Recurrence */}
            <View style={styles.fieldGap}>
              <Eyebrow>{t('lounge.criarEvento.recurrenceLabel')}</Eyebrow>
              <View style={[styles.row, { gap: 8, marginTop: 10 }]}>
                {(['none', 'recurring'] as Recurrence[]).map(r => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setRecurrence(r)}
                    style={[styles.toggleBtn, recurrence === r && styles.toggleBtnActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.toggleBtnText, recurrence === r && styles.toggleBtnTextActive]}>
                      {r === 'none' ? t('lounge.criarEvento.recurrenceNone') : t('lounge.criarEvento.recurrenceYes')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {recurrence === 'recurring' && (
                <View style={[styles.row, { gap: 6, marginTop: 10 }]}>
                  {(['weekly', 'biweekly', 'monthly'] as FreqOption[]).map(f => {
                    const label = f === 'weekly'
                      ? t('lounge.criarEvento.freqWeekly')
                      : f === 'biweekly'
                      ? t('lounge.criarEvento.freqBiweekly')
                      : t('lounge.criarEvento.freqMonthly')
                    return (
                      <TouchableOpacity
                        key={f}
                        onPress={() => setFreq(f)}
                        style={[
                          styles.freqBtn,
                          freq === f && { backgroundColor: `${accent}15`, borderColor: `${accent}66` },
                        ]}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.freqBtnText, freq === f && { color: accent }]}>
                          {label.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}
            </View>

            {/* Image */}
            <View style={styles.fieldGap}>
              <Eyebrow>{t('lounge.criarEvento.imageLabel')}</Eyebrow>
              <TouchableOpacity style={styles.imageUpload} activeOpacity={0.7}>
                <Text style={styles.imageUploadText}>{t('lounge.criarEvento.imageHint')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <PrimaryButton
              label={t('lounge.criarEvento.continue')}
              onPress={() => setStep(2)}
              state={canContinue ? 'default' : 'disabled'}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    )
  }

  // ── Step 2: Tipo, lotes e visibilidade ────────────────────────────────────────

  if (step === 2) {
    return (
      <View style={styles.root}>
        <Header
          variant="title"
          title={t('lounge.criarEvento.title')}
          contextLabel={t('lounge.criarEvento.step2Label')}
          onBack={() => setStep(1)}
        />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Type */}
            <Eyebrow>{t('lounge.criarEvento.typeLabel')}</Eyebrow>
            <View style={[styles.row, { gap: 8, marginTop: 10 }]}>
              {(['free', 'paid'] as EventType[]).map(tp => (
                <TouchableOpacity
                  key={tp}
                  onPress={() => setEventType(tp)}
                  style={[styles.typeBtn, eventType === tp && styles.typeBtnActive]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.typeBtnText, eventType === tp && styles.typeBtnTextActive]}>
                    {tp === 'free' ? t('lounge.criarEvento.typeFree') : t('lounge.criarEvento.typePaid')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Batches — only if paid */}
            {eventType === 'paid' && (
              <View style={styles.fieldGap}>
                <View style={styles.rowBetween}>
                  <Eyebrow>{t('lounge.criarEvento.batchesLabel')}</Eyebrow>
                  <Text style={styles.batchTotalCap}>
                    {t('lounge.criarEvento.batchTotalCap', { sold: 0, cap: totalBatchCap })}
                  </Text>
                </View>

                <View style={styles.batchList}>
                  {batches.map((batch, i) => {
                    const albers = parseFloat(batch.priceR) || 0
                    return (
                      <View key={i} style={styles.batchCard}>
                        {/* Batch header */}
                        <View style={styles.batchHeader}>
                          <TextInput
                            style={styles.batchNameInput}
                            value={batch.name}
                            onChangeText={v => updateBatch(i, 'name', v)}
                            placeholderTextColor="rgba(255,255,255,0.25)"
                          />
                          {batches.length > 1 && (
                            <TouchableOpacity onPress={() => removeBatch(i)}>
                              <Text style={styles.removeBatchText}>{t('lounge.criarEvento.removeBatch')}</Text>
                            </TouchableOpacity>
                          )}
                        </View>

                        {/* Price + Qty */}
                        <View style={[styles.row, { gap: 8 }]}>
                          <View style={styles.flex}>
                            <Text style={styles.batchFieldLabel}>{t('lounge.criarEvento.batchPriceLabel')}</Text>
                            <TextInput
                              style={styles.batchInput}
                              value={batch.priceR}
                              onChangeText={v => updateBatch(i, 'priceR', v.replace(/[^\d.]/g, ''))}
                              placeholder="0"
                              placeholderTextColor="rgba(255,255,255,0.25)"
                              keyboardType="decimal-pad"
                            />
                          </View>
                          <View style={styles.flex}>
                            <Text style={styles.batchFieldLabel}>{t('lounge.criarEvento.batchQtyLabel')}</Text>
                            <TextInput
                              style={styles.batchInput}
                              value={batch.qty}
                              onChangeText={v => updateBatch(i, 'qty', v.replace(/[^\d]/g, ''))}
                              placeholder="0"
                              placeholderTextColor="rgba(255,255,255,0.25)"
                              keyboardType="numeric"
                            />
                          </View>
                        </View>

                        {/* Until date */}
                        <View style={{ marginTop: 8 }}>
                          <DatePickerField
                            label={t('lounge.criarEvento.batchUntilLabel')}
                            value={batchUntilDates[i] ?? null}
                            onChange={d => setBatchUntilDate(i, d)}
                            minimumDate={tomorrow()}
                            placeholder="DD/MM/AAAA"
                          />
                        </View>

                        {/* Albers equivalent */}
                        {albers > 0 && (
                          <Text style={styles.batchAlbers}>
                            {t('lounge.criarEvento.batchAlbers', { n: albers })}
                          </Text>
                        )}
                      </View>
                    )
                  })}

                  {/* Add batch */}
                  <TouchableOpacity
                    onPress={addBatch}
                    style={[styles.addBatchBtn, { borderColor: `${accent}55` }]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.addBatchText, { color: accent }]}>
                      {t('lounge.criarEvento.addBatch')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Visibility */}
            <View style={styles.fieldGap}>
              <Eyebrow>{t('lounge.criarEvento.visLabel')}</Eyebrow>
              <View style={[styles.row, { gap: 8, marginTop: 10 }]}>
                {(['members_only', 'public'] as Visibility[]).map(v => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setVisibility(v)}
                    style={[styles.toggleBtn, visibility === v && styles.toggleBtnActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.toggleBtnText, visibility === v && styles.toggleBtnTextActive]}>
                      {v === 'members_only' ? t('lounge.criarEvento.visMembers') : t('lounge.criarEvento.visAll')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <PrimaryButton
              label={t('lounge.criarEvento.reviewCta')}
              onPress={() => setStep(3)}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    )
  }

  // ── Step 3: Revisão ───────────────────────────────────────────────────────────

  const freqLabel = freq === 'weekly'
    ? t('lounge.criarEvento.freqWeekly')
    : freq === 'biweekly'
    ? t('lounge.criarEvento.freqBiweekly')
    : t('lounge.criarEvento.freqMonthly')

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={t('lounge.criarEvento.title')}
        contextLabel={t('lounge.criarEvento.step3Label')}
        onBack={() => setStep(2)}
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 80, spacing.xl) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Preview card */}
        <Eyebrow>{t('lounge.criarEvento.previewLabel')}</Eyebrow>
        <View style={[styles.previewCard, { borderColor: `${accent}44` }]}>
          <Text style={styles.previewName}>{name}</Text>
          {desc.length > 0 && <Text style={styles.previewDesc}>{desc}</Text>}
          <View style={styles.chipsRow}>
            {date !== '' && (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{date}{time ? ` · ${time}` : ''}</Text>
              </View>
            )}
            {effectiveCap > 0 && (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{t('lounge.criarEvento.capacityChip', { n: effectiveCap })}</Text>
              </View>
            )}
            {recurrence === 'recurring' && (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{freqLabel}</Text>
              </View>
            )}
            <View style={styles.chip}>
              <Text style={styles.chipText}>
                {eventType === 'free' ? t('lounge.criarEvento.typeFree') : t('lounge.criarEvento.typePaid')}
              </Text>
            </View>
            <View style={styles.chip}>
              <Text style={styles.chipText}>
                {visibility === 'members_only' ? t('lounge.criarEvento.visMembers') : t('lounge.criarEvento.visAll')}
              </Text>
            </View>
          </View>
        </View>

        {/* Batch summary */}
        {eventType === 'paid' && (
          <>
            <View style={{ marginTop: 20 }}>
              <Eyebrow>{t('lounge.criarEvento.batchesLabel')}</Eyebrow>
            </View>
            <View style={styles.batchSummaryList}>
              {batches.map((b, i) => {
                const albers = parseFloat(b.priceR) || 0
                return (
                  <View key={i} style={[styles.batchSummaryItem, i > 0 && styles.batchSummaryBorder]}>
                    <View>
                      <Text style={styles.batchSummaryName}>{b.name}</Text>
                      <Text style={styles.batchSummarySub}>
                        {parseInt(b.qty) || 0} ingressos
                        {b.until ? ` · até ${b.until}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.batchSummaryPrice}>{albers} A</Text>
                      <Text style={styles.batchSummarySub}>R$ {b.priceR || '0'}</Text>
                    </View>
                  </View>
                )
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PrimaryButton
          label={t('lounge.criarEvento.publishCta')}
          onPress={handlePublish}
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
  row: { flexDirection: 'row' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldGap: { marginTop: 24 },

  // Inputs
  nameInput: {
    marginTop: 8,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.18)',
    fontSize: 18,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  descInput: {
    marginTop: 8,
    padding: 12,
    minHeight: 72,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    lineHeight: 21,
  },
  fieldInput: {
    marginTop: 8,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  fieldHint: {
    marginTop: 6,
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
  },

  // Toggle buttons
  toggleBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 9,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.28)',
  },
  toggleBtnText: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.65)',
  },
  toggleBtnTextActive: {
    color: colors.white[100],
  },

  // Freq chips
  freqBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 7,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  freqBtnText: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 11 * 0.06,
    textTransform: 'uppercase',
  },

  // Type buttons
  typeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  typeBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.28)',
  },
  typeBtnText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.65)',
  },
  typeBtnTextActive: {
    color: colors.white[100],
  },

  // Image upload
  imageUpload: {
    marginTop: 10,
    padding: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    alignItems: 'center',
  },
  imageUploadText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
  },

  // Batches
  batchList: { marginTop: 10, gap: 10 },
  batchTotalCap: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
  },
  batchCard: {
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    gap: 8,
  },
  batchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  batchNameInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    padding: 0,
  },
  removeBatchText: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(239,68,68,0.7)',
  },
  batchFieldLabel: {
    fontSize: 9.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 9.5 * 0.1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  batchInput: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    padding: 8,
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  batchAlbers: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
  },
  addBatchBtn: {
    paddingVertical: 10,
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderRadius: 8,
    alignItems: 'center',
  },
  addBatchText: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    letterSpacing: 11.5 * 0.04,
  },

  // Preview (step 3)
  previewCard: {
    marginTop: 12,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderRadius: 14,
    gap: 6,
  },
  previewName: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    marginBottom: 2,
  },
  previewDesc: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 18,
    marginBottom: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 4,
  },
  chipText: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 10.5 * 0.04,
  },

  // Batch summary
  batchSummaryList: {
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
  },
  batchSummaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  batchSummaryBorder: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  batchSummaryName: {
    fontSize: 12.5,
    fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  batchSummarySub: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 1,
  },
  batchSummaryPrice: {
    fontSize: 12.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
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

  // Error state
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
  },
})
