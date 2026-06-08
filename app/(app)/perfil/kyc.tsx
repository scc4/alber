import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as ImagePicker from 'expo-image-picker'
import { useAuthStore } from '../../../store/auth.store'
import * as authService from '../../../services/auth.service'
import { WebViewModal } from '../../../components/shared/WebViewModal'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const BFF          = SUPABASE_URL + '/functions/v1'
const ANON_KEY     = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

type Step    = 'status' | 'choose_doc' | 'capture_front' | 'capture_back' | 'capture_selfie' | 'review' | 'sent'
type DocType = 'rg' | 'cnh'

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps { label: string; onBack: () => void }

function Header({ label, onBack }: HeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{label}</Text>
      <View style={styles.backBtn} />
    </View>
  )
}

// ── StatusCard ────────────────────────────────────────────────────────────────

interface StatusCardProps { onStartFlow: () => void }

function StatusCard({ onStartFlow }: StatusCardProps) {
  const { t }     = useTranslation()
  const kycStatus = useAuthStore(s => s.kycStatus)

  const config = {
    pending: {
      icon: '⚠',
      iconColor: colors.warning[500],
      iconBg: `${colors.warning[500]}1A`,
      iconBorder: `${colors.warning[500]}4D`,
      title: t('perfil.kyc.pendingTitle'),
      body:  t('perfil.kyc.pendingBody'),
      cta:   t('perfil.kyc.pendingCta'),
    },
    submitted: {
      icon: '⏳',
      iconColor: colors.warning[500],
      iconBg: `${colors.warning[500]}1A`,
      iconBorder: `${colors.warning[500]}4D`,
      title: t('perfil.kyc.submittedTitle'),
      body:  t('perfil.kyc.submittedBody'),
      cta:   null,
    },
    approved: {
      icon: '✓',
      iconColor: colors.state.success,
      iconBg: `${colors.state.success}1A`,
      iconBorder: `${colors.state.success}4D`,
      title: t('perfil.kyc.approvedTitle'),
      body:  t('perfil.kyc.approvedBody'),
      cta:   null,
    },
    rejected: {
      icon: '✗',
      iconColor: colors.state.error,
      iconBg: `${colors.state.error}1A`,
      iconBorder: `${colors.state.error}4D`,
      title: t('perfil.kyc.rejectedTitle'),
      body:  t('perfil.kyc.rejectedBody', { reason: '' }),
      cta:   t('perfil.kyc.rejectedCta'),
    },
  }[kycStatus]

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.statusContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.statusIcon, { backgroundColor: config.iconBg, borderColor: config.iconBorder }]}>
        <Text style={[styles.statusIconText, { color: config.iconColor }]}>{config.icon}</Text>
      </View>
      <Text style={styles.statusTitle}>{config.title}</Text>
      <Text style={styles.statusBody}>{config.body}</Text>

      {config.cta && (
        <TouchableOpacity style={styles.cta} onPress={onStartFlow} activeOpacity={0.75}>
          <Text style={styles.ctaText}>{config.cta}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

// ── ChooseDoc ─────────────────────────────────────────────────────────────────

interface ChooseDocProps { onChoose: (doc: DocType) => void }

function ChooseDoc({ onChoose }: ChooseDocProps) {
  const { t } = useTranslation()

  return (
    <View style={styles.chooseWrap}>
      <Text style={styles.chooseTitle}>{t('perfil.kyc.chooseDoc')}</Text>
      {(['rg', 'cnh'] as DocType[]).map(doc => (
        <TouchableOpacity
          key={doc}
          style={styles.docOption}
          onPress={() => onChoose(doc)}
          activeOpacity={0.7}
        >
          <Text style={styles.docOptionText}>
            {doc === 'rg' ? t('perfil.kyc.docRG') : t('perfil.kyc.docCNH')}
          </Text>
          <Text style={styles.docOptionChevron}>›</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

// ── CaptureStep ───────────────────────────────────────────────────────────────

interface CaptureStepProps {
  label:     string
  ctaLabel:  string
  isSelfie?: boolean
  onCapture: (base64: string) => void
}

function CaptureStep({ label, ctaLabel, isSelfie = false, onCapture }: CaptureStepProps) {
  const { t } = useTranslation()
  const [cameraStatus, requestCameraPermission] = ImagePicker.useCameraPermissions()
  const [capturing, setCapturing]               = useState(false)
  const [permError, setPermError]               = useState(false)

  const handleCapture = async () => {
    setPermError(false)
    if (!cameraStatus?.granted) {
      const res = await requestCameraPermission()
      if (!res.granted) { setPermError(true); return }
    }
    setCapturing(true)
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes:    ImagePicker.MediaTypeOptions.Images,
        quality:       0.7,
        base64:        true,
        allowsEditing: true,
        aspect:        isSelfie ? [1, 1] : [4, 3],
      })
      if (!result.canceled && result.assets[0]?.base64) {
        onCapture(result.assets[0].base64)
      }
    } finally {
      setCapturing(false)
    }
  }

  return (
    <View style={styles.cameraWrap}>
      <Text style={styles.cameraLabel}>{label}</Text>

      <View style={[styles.viewfinder, isSelfie && styles.viewfinderSelfie]}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
        <Text style={styles.viewfinderHint}>
          {isSelfie ? 'Posicione o rosto no centro' : 'Posicione o documento no quadro'}
        </Text>
      </View>

      {permError && (
        <Text style={styles.permError}>{t('perfil.kyc.cameraPermissionDenied')}</Text>
      )}

      <TouchableOpacity
        style={[styles.captureBtn, capturing && { opacity: 0.5 }]}
        onPress={handleCapture}
        disabled={capturing}
        activeOpacity={0.8}
      >
        {capturing
          ? <ActivityIndicator color={colors.black[100]} />
          : <View style={styles.captureBtnInner} />
        }
      </TouchableOpacity>
      <Text style={styles.captureBtnLabel}>{ctaLabel}</Text>
    </View>
  )
}

// ── Review ────────────────────────────────────────────────────────────────────

interface ReviewProps {
  docType:     DocType
  photos:      { front: string; back: string; selfie: string }
  submitting:  boolean
  submitError: string | null
  onRetake:    (which: 'front' | 'back' | 'selfie') => void
  onSubmit:    () => void
}

function Review({ docType, photos, submitting, submitError, onRetake, onSubmit }: ReviewProps) {
  const { t } = useTranslation()

  const items: { key: 'front' | 'back' | 'selfie'; label: string }[] = [
    { key: 'front',  label: t('perfil.kyc.frontLabel') },
    { key: 'back',   label: t('perfil.kyc.backLabel') },
    { key: 'selfie', label: t('perfil.kyc.selfieLabel') },
  ]

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.reviewContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.chooseTitle}>{t('perfil.kyc.stepReview')}</Text>
      <Text style={styles.reviewDocType}>
        {docType === 'rg' ? t('perfil.kyc.docRG') : t('perfil.kyc.docCNH')}
      </Text>

      {items.map(({ key, label }) => (
        <View key={key} style={styles.reviewItem}>
          <Image
            source={{ uri: `data:image/jpeg;base64,${photos[key]}` }}
            style={styles.reviewThumb}
            resizeMode="cover"
          />
          <View style={styles.reviewItemMeta}>
            <Text style={styles.reviewItemLabel}>{label}</Text>
            <Text style={styles.reviewItemCaptured}>Capturado</Text>
          </View>
          <TouchableOpacity
            onPress={() => onRetake(key)}
            disabled={submitting}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.retakeBtn}>{t('perfil.kyc.retake')}</Text>
          </TouchableOpacity>
        </View>
      ))}

      {submitError && (
        <Text style={styles.submitError}>{submitError}</Text>
      )}

      <TouchableOpacity
        style={[styles.cta, { marginTop: spacing.xl }, submitting && { opacity: 0.6 }]}
        onPress={onSubmit}
        disabled={submitting}
        activeOpacity={0.75}
      >
        {submitting
          ? <ActivityIndicator color={colors.black[100]} />
          : <Text style={styles.ctaText}>{t('perfil.kyc.publishCta')}</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  )
}

// ── Sent ──────────────────────────────────────────────────────────────────────

function Sent() {
  const { t } = useTranslation()
  return (
    <View style={styles.sentWrap}>
      <View style={styles.sentIcon}>
        <Text style={styles.sentIconText}>📄</Text>
      </View>
      <Text style={styles.statusTitle}>{t('perfil.kyc.sentTitle')}</Text>
      <Text style={styles.statusBody}>{t('perfil.kyc.sentBody')}</Text>
      <TouchableOpacity style={styles.cta} onPress={() => router.back()} activeOpacity={0.75}>
        <Text style={styles.ctaText}>{t('perfil.kyc.backCta')}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function KycScreen() {
  const { t }        = useTranslation()
  const token        = useAuthStore(s => s.token)
  const user         = useAuthStore(s => s.user)
  const setKycStatus = useAuthStore(s => s.setKycStatus)

  const [step, setStep]               = useState<Step>('status')
  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null)
  const [webViewVisible, setWebViewVisible] = useState(false)
  const [docType, setDocType]     = useState<DocType | null>(null)
  const [photoFront, setFront]    = useState<string | null>(null)
  const [photoBack, setBack]      = useState<string | null>(null)
  const [photoSelfie, setSelfie]  = useState<string | null>(null)
  const [submitting, setSubmitting]   = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const headerLabel = t('perfil.kyc.title')

  useEffect(() => {
    if (!token || !user?.id) return
    ;(async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}&select=onboarding_url`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) return
        const rows: { onboarding_url: string | null }[] = await res.json()
        setOnboardingUrl(rows?.[0]?.onboarding_url ?? null)
      } catch { /* silencioso — fluxo de câmera como fallback */ }
    })()
  }, [token, user?.id])

  const handleWebViewClose = async () => {
    setWebViewVisible(false)
    if (!token) return
    try {
      const profile = await authService.fetchUserProfile(token)
      if (profile?.kyc_status && profile.kyc_status !== 'pending') {
        setKycStatus(profile.kyc_status as Parameters<typeof setKycStatus>[0])
      }
    } catch { /* mantém status atual */ }
  }

  const handleBack = () => {
    switch (step) {
      case 'choose_doc':    setStep('status');          break
      case 'capture_front': setStep('choose_doc');      break
      case 'capture_back':  setStep('capture_front');   break
      case 'capture_selfie':setStep('capture_back');    break
      case 'review':        setStep('capture_selfie');  break
      default:              router.back()
    }
  }

  const handleChooseDoc = (doc: DocType) => {
    setDocType(doc)
    setStep('capture_front')
  }

  const handleCaptureFront = (b64: string) => { setFront(b64);  setStep('capture_back') }
  const handleCaptureBack  = (b64: string) => { setBack(b64);   setStep('capture_selfie') }
  const handleCaptureSelfie = (b64: string) => { setSelfie(b64); setStep('review') }

  const handleRetake = (which: 'front' | 'back' | 'selfie') => {
    if (which === 'front')  { setFront(null);  setStep('capture_front') }
    if (which === 'back')   { setBack(null);   setStep('capture_back') }
    if (which === 'selfie') { setSelfie(null); setStep('capture_selfie') }
  }

  const handleSubmit = async () => {
    if (!photoFront || !photoBack || !photoSelfie || !token) return
    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch(`${BFF}/kyc-submit`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
          apikey:         ANON_KEY,
        },
        body: JSON.stringify({
          doc_type:      docType,
          front_base64:  photoFront,
          back_base64:   photoBack,
          selfie_base64: photoSelfie,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSubmitError((data as { message?: string }).message ?? t('perfil.kyc.submitError'))
        return
      }

      setKycStatus('submitted')
      setStep('sent')
    } catch {
      setSubmitError(t('perfil.kyc.submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <WebViewModal
        visible={webViewVisible}
        url={onboardingUrl ?? ''}
        title={t('perfil.kyc.webViewTitle')}
        onClose={handleWebViewClose}
      />

      {step !== 'sent' && (
        <Header label={headerLabel} onBack={handleBack} />
      )}

      {step === 'status' && (
        <StatusCard
          onStartFlow={() => {
            if (onboardingUrl) {
              setWebViewVisible(true)
            } else {
              setStep('choose_doc')
            }
          }}
        />
      )}

      {step === 'choose_doc' && (
        <ChooseDoc onChoose={handleChooseDoc} />
      )}

      {step === 'capture_front' && (
        <CaptureStep
          label={t('perfil.kyc.stepFront')}
          ctaLabel={t('perfil.kyc.captureFront')}
          onCapture={handleCaptureFront}
        />
      )}

      {step === 'capture_back' && (
        <CaptureStep
          label={t('perfil.kyc.stepBack')}
          ctaLabel={t('perfil.kyc.captureBack')}
          onCapture={handleCaptureBack}
        />
      )}

      {step === 'capture_selfie' && (
        <CaptureStep
          label={t('perfil.kyc.stepSelfie')}
          ctaLabel={t('perfil.kyc.captureSelfie')}
          isSelfie
          onCapture={handleCaptureSelfie}
        />
      )}

      {step === 'review' && docType && photoFront && photoBack && photoSelfie && (
        <Review
          docType={docType}
          photos={{ front: photoFront, back: photoBack, selfie: photoSelfie }}
          submitting={submitting}
          submitError={submitError}
          onRetake={handleRetake}
          onSubmit={handleSubmit}
        />
      )}

      {step === 'sent' && <Sent />}
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CORNER_SIZE  = 20
const CORNER_THICK = 2.5

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn:    { width: 32 },
  backIcon:   { fontSize: 20, color: colors.white[100] },
  headerTitle: {
    ...typography.size.caption,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // Status card
  statusContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  statusIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  statusIconText: {
    fontSize: 32,
  },
  statusTitle: {
    ...typography.size.h1,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  statusBody: {
    ...typography.size.bodySmall,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  // Choose doc
  chooseWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  chooseTitle: {
    ...typography.size.h2,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    marginBottom: spacing.lg,
  },
  docOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  docOptionText: {
    flex: 1,
    ...typography.size.body,
    color: colors.white[100],
  },
  docOptionChevron: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.25)',
  },
  // Camera capture
  cameraWrap: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  cameraLabel: {
    ...typography.size.label,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  viewfinder: {
    width: 280,
    height: 180,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  viewfinderSelfie: {
    width: 220,
    height: 280,
    borderRadius: 110,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICK, borderRightWidth: CORNER_THICK, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICK, borderRightWidth: CORNER_THICK, borderBottomRightRadius: 4 },
  viewfinderHint: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  permError: {
    ...typography.size.caption,
    color: colors.state.error,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  captureBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: colors.white[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.white[100],
  },
  captureBtnLabel: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.5)',
    marginTop: spacing.sm,
  },
  // Review
  reviewContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  reviewDocType: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.lg,
  },
  reviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  reviewThumb: {
    width: 48,
    height: 36,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  reviewItemMeta: { flex: 1 },
  reviewItemLabel: {
    ...typography.size.label,
    color: colors.white[100],
  },
  reviewItemCaptured: {
    ...typography.size.caption,
    color: colors.state.success,
    marginTop: 2,
  },
  retakeBtn: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.4)',
    textDecorationLine: 'underline',
  },
  submitError: {
    ...typography.size.caption,
    color: colors.state.error,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  // Sent
  sentWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  sentIconText: { fontSize: 36 },
  // Shared CTA
  cta: {
    height: spacing.buttonHeight,
    borderRadius: spacing.radius.md,
    backgroundColor: colors.white[100],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    alignSelf: 'stretch',
  },
  ctaText: {
    ...typography.button,
    color: colors.black[100],
  },
})
