// Design: /design/flows-split.jsx — SplitDetailScreen
// Spec: /specs/06_modules/split.md
// Detalhe do split: stats, feed de lançamentos, participantes, ações do dono.

import { useEffect, useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Modal,
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
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useSplitStore } from '../../../store/split.store'
import { useAuthStore } from '../../../store/auth.store'
import { LaunchItem } from '../../../components/split/LaunchItem'
import { ParticipantRow } from '../../../components/split/ParticipantRow'
import { Header } from '../../../components/core/Header'
import { Eyebrow } from '../../../components/shared/Eyebrow'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { formatAlbers } from '../../../utils/format'
import { colors, spaceSkins } from '../../../tokens/colors'
import { spacing } from '../../../tokens/spacing'
import { typography } from '../../../tokens/typography'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string, t: ReturnType<typeof useTranslation>['t']): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1)  return t('split.timeJustNow')
  if (min < 60) return t('split.timeMinAgo', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24)   return t('split.timeHourAgo', { n: h })
  return t('split.timeDayAgo', { n: Math.floor(h / 24) })
}

function acceptedCount(split: ReturnType<typeof useSplitStore.getState>['splits'][number]) {
  return split.participants.filter(p => p.status === 'accepted').length
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SplitDetailScreen() {
  const { id }     = useLocalSearchParams<{ id: string }>()
  const { t }      = useTranslation()
  const insets     = useSafeAreaInsets()

  const token         = useAuthStore(s => s.token)
  const currentUserId = useAuthStore(s => s.user?.id ?? '')

  const split      = useSplitStore(s => s.getSplitById(id))
  const loading    = useSplitStore(s => s.loading)
  const launchItem = useSplitStore(s => s.launchItem)
  const fetchSplit = useSplitStore(s => s.fetchSplit)

  useEffect(() => {
    if (id && token) fetchSplit(id, token)
  }, [id, token])

  const [recalcDismissed, setRecalcDismissed] = useState(false)
  const [showLaunchSheet, setShowLaunchSheet] = useState(false)
  const [showExtend, setShowExtend]           = useState(false)
  const [extendDays, setExtendDays]           = useState(7)
  const [lightboxUri, setLightboxUri]         = useState<string | null>(null)

  // ── Loading / not found ───────────────────────────────────────────────────────

  if (!split && loading) {
    return (
      <View style={styles.root}>
        <Header variant="title" title="…" onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.dimText}>…</Text>
        </View>
      </View>
    )
  }

  if (!split) {
    return (
      <View style={styles.root}>
        <Header variant="title" title="Split" onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Split não encontrado.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
            <Text style={styles.backLinkText}>‹ Voltar</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const isFixed    = split.type === 'fixed'
  const isActive   = split.status === 'active'
  const isOwner    = split.ownerId === currentUserId
  const accepted   = acceptedCount(split)
  const perPerson  = accepted > 0 ? Math.ceil(split.totalValue / split.participantCount) : 0
  const myShare    = useSplitStore.getState().getMyShare(split.id, currentUserId)
  const myBlocked  = accepted > 0 ? Math.ceil((split.totalValue - split.totalLaunched) / accepted) : 0
  const remaining  = split.totalValue - split.totalLaunched
  const accent     = isFixed ? spaceSkins.tech.accent : spaceSkins.surf.accent

  // Show recalc banner for active variable splits that have launched items
  const showRecalc = !isFixed && isActive && split.totalLaunched > 0 && !recalcDismissed

  async function handleResend() {
    if (!split) return
    try { await Share.share({ message: split.inviteDeepLink, title: split.name }) } catch { /* ignore */ }
  }

  function handleExtendConfirm() {
    // TODO: chamar split-extend Edge Function quando implementado
    setShowExtend(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={split.name}
        contextLabel={t(isFixed ? 'split.detalhe.contextFixed' : 'split.detalhe.contextVariable')}
        onBack={() => router.back()}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(96, insets.bottom + spacing.bottomNavHeight + 12) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Recalc banner */}
        {showRecalc && (
          <View style={styles.recalcBanner}>
            <View style={styles.recalcIcon}>
              <Text style={{ color: spaceSkins.surf.accent, fontSize: 12 }}>↻</Text>
            </View>
            <View style={styles.recalcBody}>
              <Text style={styles.recalcTitle}>{t('split.detalhe.recalcTitle')}</Text>
              <Text style={styles.recalcText}>
                {t('split.detalhe.recalcBody', {
                  handle: split.participants[split.participants.length - 1]?.handle ?? '',
                  count: accepted,
                })}
              </Text>
            </View>
            <Pressable onPress={() => setRecalcDismissed(true)} hitSlop={8} style={styles.recalcClose}>
              <Text style={styles.recalcCloseText}>×</Text>
            </Pressable>
          </View>
        )}

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatBox
            label={t(isFixed ? 'split.detalhe.statsTotal' : 'split.detalhe.statsLaunched')}
            value={isFixed ? split.totalValue : split.totalLaunched}
            unit={t('split.detalhe.amountUnit')}
          />
          <StatBox
            label={t(isFixed ? 'split.detalhe.statsPerPerson' : 'split.detalhe.statsTarget')}
            value={isFixed ? perPerson : split.totalValue}
            unit={t('split.detalhe.amountUnit')}
          />
        </View>

        {/* "SUA PARTE ATÉ AGORA" card — variable with items */}
        {!isFixed && split.items.length > 0 && (
          <View style={styles.myShareCard}>
            <Text style={styles.myShareLabel}>{t('split.detalhe.myShareLabel')}</Text>
            <View style={styles.myShareRow}>
              <View>
                <View style={styles.myShareValueRow}>
                  <Text style={[styles.myShareNumber, { color: accent }]}>
                    {formatAlbers(myShare)}
                  </Text>
                  <Text style={styles.myShareOf}>
                    {' '}{t('split.detalhe.of')} {formatAlbers(myBlocked)} {t('split.detalhe.blockedSuffix')}
                  </Text>
                </View>
              </View>
              <Text style={styles.myShareRemaining}>
                {t('split.detalhe.remainingBudget', { value: formatAlbers(remaining) })}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, myBlocked > 0 ? (myShare / myBlocked) * 100 : 0)}%`,
                    backgroundColor: accent,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* Launch feed — variable only */}
        {!isFixed && (
          <>
            <View style={styles.sectionHeader}>
              <Eyebrow>
                {t('split.detalhe.launchesTitle')} · {t(
                  split.items.length === 1
                    ? 'split.detalhe.launchesCount_one'
                    : 'split.detalhe.launchesCount_other',
                  { count: split.items.length },
                )}
              </Eyebrow>
              {isActive && isOwner && (
                <TouchableOpacity
                  onPress={() => setShowLaunchSheet(true)}
                  style={styles.launchBtn}
                >
                  <Text style={[styles.launchBtnText, { color: accent }]}>
                    {t('split.detalhe.launchCta')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {split.items.length === 0 ? (
              <Text style={styles.launchEmpty}>{t('split.detalhe.launchEmpty')}</Text>
            ) : (
              split.items.map((item, i) => (
                <LaunchItem
                  key={item.id}
                  item={item}
                  launchedBy={split.ownerHandle}
                  timeAgo={relativeTime(item.createdAt, t)}
                  showTopBorder={i > 0}
                  onPhotoPress={item.photoUri ? () => setLightboxUri(item.photoUri) : undefined}
                />
              ))
            )}
          </>
        )}

        {/* Participants */}
        <View style={[styles.sectionHeader, styles.sectionGap]}>
          <Eyebrow>{t('split.detalhe.participantsTitle')}</Eyebrow>
        </View>
        {split.participants.map((p, i) => (
          <ParticipantRow
            key={p.id}
            participant={p}
            isMe={p.id === currentUserId}
            isVariable={!isFixed}
            showTopBorder={i > 0}
          />
        ))}

        {/* Owner actions */}
        {isActive && isOwner && (
          <View style={styles.ownerActions}>
            <TouchableOpacity onPress={handleResend} style={styles.ghostBtn} activeOpacity={0.75}>
              <Text style={styles.ghostBtnText}>{t('split.detalhe.resendLink')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowExtend(true)}
              style={styles.ghostBtn}
              activeOpacity={0.75}
            >
              <Text style={styles.ghostBtnText}>{t('split.detalhe.extendDeadline')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Closed banner */}
        {!isActive && (
          <View style={styles.closedBanner}>
            <Text style={styles.closedBannerText}>{t('split.detalhe.closedBanner')}</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA */}
      {isActive && isOwner && (
        <View style={styles.bottomBar}>
          <PrimaryButton
            label={t(isFixed ? 'split.detalhe.closeSplitFixed' : 'split.detalhe.closeSplitVariable')}
            onPress={() => router.push(`/(app)/split/fechar/${split.id}`)}
          />
        </View>
      )}

      {/* Launch item sheet */}
      {showLaunchSheet && (
        <LaunchSheet
          splitId={split.id}
          target={split.totalValue}
          alreadyLaunched={split.totalLaunched}
          participantCount={accepted}
          accentColor={accent}
          onClose={() => setShowLaunchSheet(false)}
          onLaunch={async (desc, value, photoUri) => {
            await launchItem(
              { split_id: split.id, description: desc, value, photo_url: photoUri },
              token!,
            )
            setShowLaunchSheet(false)
          }}
        />
      )}

      {/* Photo lightbox — spec 11.1 */}
      {lightboxUri !== null && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setLightboxUri(null)}>
          <Pressable
            style={styles.lightboxOverlay}
            onPress={() => setLightboxUri(null)}
          >
            <TouchableOpacity
              onPress={() => setLightboxUri(null)}
              style={styles.lightboxClose}
              hitSlop={8}
            >
              <Text style={styles.lightboxCloseText}>✕</Text>
            </TouchableOpacity>
            <View style={styles.lightboxFrame}>
              <Image
                source={{ uri: lightboxUri }}
                style={styles.lightboxImage}
                resizeMode="cover"
              />
            </View>
          </Pressable>
        </Modal>
      )}

      {/* Extend expiry modal */}
      <Modal
        visible={showExtend}
        transparent
        animationType="slide"
        onRequestClose={() => setShowExtend(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowExtend(false)}>
          <Pressable style={[styles.extendSheet, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.extendTitle}>{t('split.detalhe.extendDeadline')}</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                onPress={() => setExtendDays(d => Math.max(1, d - 1))}
                style={styles.stepBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepCount}>
                {extendDays} {t('split.criar.customDaysUnit')}
              </Text>
              <TouchableOpacity
                onPress={() => setExtendDays(d => Math.min(90, d + 1))}
                style={styles.stepBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <PrimaryButton
              label="Confirmar"
              onPress={handleExtendConfirm}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

// ─── StatBox ──────────────────────────────────────────────────────────────────

function StatBox({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View style={stat.box}>
      <Text style={stat.label}>{label}</Text>
      <View style={stat.valueRow}>
        <Text style={stat.value}>{formatAlbers(value)}</Text>
        <Text style={stat.unit}>{unit}</Text>
      </View>
    </View>
  )
}

const stat = StyleSheet.create({
  box: {
    flex: 1,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.md,
  },
  label: {
    fontSize: 9.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 9.5 * 0.14,
    textTransform: 'uppercase',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginTop: 4,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -22 * 0.02,
  },
  unit: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
  },
})

// ─── LaunchSheet ──────────────────────────────────────────────────────────────
// Spec 11.1: foto opcional por item — somente câmera, 1 foto por item.
// Integração real: instalar expo-image-picker e trocar capturePhoto() abaixo.

interface LaunchSheetProps {
  splitId: string
  target: number
  alreadyLaunched: number
  participantCount: number
  accentColor: string
  onClose: () => void
  onLaunch: (description: string, value: number, photoUri?: string) => Promise<void>
}

function LaunchSheet({
  target, alreadyLaunched, participantCount, accentColor, onClose, onLaunch,
}: LaunchSheetProps) {
  const { t }                           = useTranslation()
  const insets                          = useSafeAreaInsets()
  const [desc, setDesc]                 = useState('')
  const [valueStr, setVal]              = useState('')
  const [photoUri, setPhotoUri]         = useState<string | null>(null)
  const [showCamera, setShowCamera]     = useState(false)
  const [launching, setLaunching]       = useState(false)

  const v           = parseFloat(valueStr) || 0
  const wouldExceed = alreadyLaunched + v > target
  const perPerson   = v && participantCount > 0 ? Math.ceil(v / participantCount) : 0
  const canConfirm  = desc.trim().length > 0 && v > 0 && !wouldExceed

  // Substituir pelo expo-image-picker quando instalado:
  // import * as ImagePicker from 'expo-image-picker'
  // const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'Images', quality: 0.8 })
  // if (!result.canceled) setPhotoUri(result.assets[0].uri)
  function openCamera() { setShowCamera(true) }

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.modalOverlay} onPress={onClose}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ width: '100%' }}
          >
            <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
              <Text style={styles.sheetTitle}>{t('split.lancar.title')}</Text>
              <Text style={styles.sheetSubtitle}>
                {t('split.lancar.subtitle', { count: participantCount })}
              </Text>

              {/* Description */}
              <View style={styles.fieldBlock}>
                <Eyebrow>{t('split.lancar.descLabel')}</Eyebrow>
                <TextInput
                  style={styles.sheetInput}
                  value={desc}
                  onChangeText={setDesc}
                  placeholder={t('split.lancar.descPlaceholder')}
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  autoFocus
                  returnKeyType="next"
                />
              </View>

              {/* Value */}
              <View style={styles.fieldBlock}>
                <Eyebrow>{t('split.lancar.valueLabel')}</Eyebrow>
                <TextInput
                  style={[styles.sheetValueInput, wouldExceed && { color: colors.state.error }]}
                  value={valueStr}
                  onChangeText={s => setVal(s.replace(/[^\d]/g, ''))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  returnKeyType="done"
                />
              </View>

              {/* Photo — spec 11.1 */}
              <View style={styles.fieldBlock}>
                <Eyebrow>{t('split.lancar.photoLabel')}</Eyebrow>
                {photoUri ? (
                  <View style={styles.photoPreviewRow}>
                    <Image
                      source={{ uri: photoUri }}
                      style={styles.photoThumb}
                      resizeMode="cover"
                    />
                    <View style={styles.photoMeta}>
                      <Text style={styles.photoCaption}>{t('split.lancar.photoCaption')}</Text>
                      <Text style={styles.photoSubcaption}>{t('split.lancar.photoSubcaption')}</Text>
                    </View>
                    <TouchableOpacity onPress={openCamera} style={styles.replaceBtn}>
                      <Text style={styles.replaceBtnText}>{t('split.lancar.replacePhoto')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setPhotoUri(null)} style={styles.removeBtn} hitSlop={8}>
                      <Text style={styles.removeBtnText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={openCamera} style={styles.addPhotoBtn} activeOpacity={0.75}>
                    <Text style={styles.addPhotoBtnText}>📷  {t('split.lancar.addPhotoCta')}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Preview */}
              {v > 0 && (
                <View style={[
                  styles.previewBox,
                  wouldExceed
                    ? { backgroundColor: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.25)' }
                    : { backgroundColor: 'rgba(91,206,201,0.06)', borderColor: 'rgba(91,206,201,0.18)' },
                ]}>
                  <Text style={[styles.previewText, { color: wouldExceed ? colors.state.error : 'rgba(91,206,201,0.85)' }]}>
                    {wouldExceed
                      ? t('split.lancar.previewExceed', { over: (alreadyLaunched + v - target).toFixed(0) })
                      : t('split.lancar.previewOk', {
                          perPerson,
                          after: alreadyLaunched + v,
                          target,
                        })}
                  </Text>
                </View>
              )}

              <PrimaryButton
                label={t('split.lancar.confirmCta')}
                onPress={async () => {
                  if (!canConfirm || launching) return
                  setLaunching(true)
                  try { await onLaunch(desc, v, photoUri ?? undefined) }
                  finally { setLaunching(false) }
                }}
                state={launching ? 'loading' : canConfirm ? 'default' : 'disabled'}
              />
              <TouchableOpacity onPress={onClose} style={styles.sheetCancel}>
                <Text style={styles.sheetCancelText}>{t('split.lancar.cancelCta')}</Text>
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Camera capture sheet — spec 11.1: somente câmera, não galeria */}
      {showCamera && (
        <CameraSheet
          onClose={() => setShowCamera(false)}
          onCapture={(uri) => { setPhotoUri(uri); setShowCamera(false) }}
        />
      )}
    </>
  )
}

// ─── CameraSheet ──────────────────────────────────────────────────────────────
// UI do viewfinder. Substituir handleCapture por ImagePicker.launchCameraAsync()
// quando expo-image-picker estiver instalado.

function CameraSheet({
  onClose,
  onCapture,
}: {
  onClose: () => void
  onCapture: (uri: string) => void
}) {
  const { t }    = useTranslation()
  const insets   = useSafeAreaInsets()

  // Mock: gera URI placeholder. Trocar por chamada real ao expo-image-picker.
  function handleCapture() {
    onCapture(`mock://photo/${Date.now()}`)
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={cam.root}>
        {/* Top bar */}
        <View style={[cam.topBar, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={onClose} style={cam.closeBtn}>
            <Text style={cam.closeBtnText}>{t('split.lancar.cameraClose')}</Text>
          </TouchableOpacity>
          <Text style={cam.topLabel}>{t('split.lancar.cameraHint')}</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Viewfinder */}
        <View style={cam.viewfinder}>
          <View style={cam.frame}>
            {/* Corner marks */}
            <View style={[cam.corner, cam.cornerTL]} />
            <View style={[cam.corner, cam.cornerTR]} />
            <View style={[cam.corner, cam.cornerBL]} />
            <View style={[cam.corner, cam.cornerBR]} />
            <Text style={cam.hintText}>{t('split.lancar.cameraCapture')}</Text>
          </View>
        </View>

        {/* Shutter */}
        <View style={[cam.shutterArea, { paddingBottom: insets.bottom + 20 }]}>
          <TouchableOpacity onPress={handleCapture} style={cam.shutter} activeOpacity={0.85}>
            <View style={cam.shutterInner} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const cam = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  topLabel: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 10 * 0.14,
    textTransform: 'uppercase',
  },
  viewfinder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  frame: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: spaceSkins.surf.accent,
    borderWidth: 2,
  },
  cornerTL: { top: 14, left: 14, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 14, right: 14, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 14, left: 14, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 14, right: 14, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  hintText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
  },
  shutterArea: {
    alignItems: 'center',
    paddingTop: 20,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
    padding: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    flex: 1,
    width: '100%',
    borderRadius: 32,
    backgroundColor: colors.white[100],
  },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },

  // States
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  dimText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.3)',
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
  },
  backLink: { padding: spacing.sm },
  backLinkText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
  },

  // Recalc banner
  recalcBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
    padding: 12,
    backgroundColor: 'rgba(91,206,201,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(91,206,201,0.28)',
    borderRadius: spacing.radius.md,
  },
  recalcIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(91,206,201,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  recalcBody: { flex: 1 },
  recalcTitle: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    marginBottom: 3,
  },
  recalcText: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 16,
  },
  recalcClose: { padding: 4 },
  recalcCloseText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.4)',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.md,
  },

  // My share card
  myShareCard: {
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.md,
    marginBottom: spacing.md,
  },
  myShareLabel: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 10 * 0.12,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  myShareRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  myShareValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  myShareNumber: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -22 * 0.02,
  },
  myShareOf: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
  },
  myShareRemaining: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionGap: { marginTop: 22 },

  // Launch feed
  launchBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(91,206,201,0.4)',
    borderRadius: spacing.radius.sm,
  },
  launchBtnText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 11 * 0.04,
  },
  launchEmpty: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    paddingVertical: 12,
    lineHeight: 18,
  },

  // Owner actions
  ownerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 24,
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

  // Closed banner
  closedBanner: {
    marginTop: 24,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
  },
  closedBannerText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.45)',
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.black[100],
  },

  // Modal overlay
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },

  // Photo lightbox
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  lightboxClose: {
    position: 'absolute',
    top: 54,
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxCloseText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  lightboxFrame: {
    width: '100%',
    maxWidth: 300,
    aspectRatio: 3 / 4,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },

  // Launch sheet
  sheet: {
    backgroundColor: colors.black[90],
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  sheetSubtitle: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 18,
    marginTop: -spacing.sm,
  },
  fieldBlock: { gap: spacing.xs },
  sheetInput: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.18)',
    paddingVertical: spacing.sm,
    fontSize: 16,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  sheetValueInput: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.18)',
    paddingVertical: spacing.sm,
    fontSize: 32,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -32 * 0.02,
  },
  previewBox: {
    padding: 10,
    borderWidth: 0.5,
    borderRadius: 10,
  },
  previewText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
  },
  sheetCancel: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  sheetCancelText: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
  },

  // Photo field (spec 11.1)
  addPhotoBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoBtnText: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.7)',
  },
  photoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  photoThumb: {
    width: 64,
    height: 48,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    flexShrink: 0,
  },
  photoMeta: { flex: 1 },
  photoCaption: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: spaceSkins.surf.accent,
    fontWeight: '500',
  },
  photoSubcaption: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 1,
  },
  replaceBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 7,
    flexShrink: 0,
  },
  replaceBtnText: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.75)',
  },
  removeBtn: {
    padding: 4,
    flexShrink: 0,
  },
  removeBtnText: {
    fontSize: 16,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
  },

  // Extend modal
  extendSheet: {
    backgroundColor: colors.black[90],
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  extendTitle: {
    fontSize: 17,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
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
    fontSize: 18,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
  },
})
