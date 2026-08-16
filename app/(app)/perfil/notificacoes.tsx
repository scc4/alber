import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/auth.store'
import * as authService from '../../../services/auth.service'
import type { NotificationPrefs } from '../../../services/auth.service'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

interface NotifState {
  txReceive:        boolean
  txSend:           boolean
  txCarregar:       boolean
  txDescarregar:    boolean
  splitParticipant: boolean
  splitExpired:     boolean
  splitClosed:      boolean
  loungeMessage:    boolean
  loungeEvent:      boolean
  loungeRequest:    boolean
  contaKyc:         boolean
}

// UI (camelCase) ↔ coluna real em users / category em push-send (ver
// _shared/push.ts NotifCategory) — mapeamento 1:1, sem agregação.
const NOTIF_KEY_MAP: Record<keyof NotifState, keyof NotificationPrefs> = {
  txReceive:        'notif_tx_receive',
  txSend:            'notif_tx_send',
  txCarregar:        'notif_tx_carregar',
  txDescarregar:     'notif_tx_descarregar',
  splitParticipant:  'notif_split_participant',
  splitExpired:      'notif_split_expired',
  splitClosed:       'notif_split_closed',
  loungeMessage:     'notif_lounge_message',
  loungeEvent:       'notif_lounge_event',
  loungeRequest:     'notif_lounge_request',
  contaKyc:          'notif_conta_kyc',
}

const DEFAULT_NOTIF: NotifState = {
  txReceive:        true,
  txSend:           true,
  txCarregar:       true,
  txDescarregar:    true,
  splitParticipant: true,
  splitExpired:     true,
  splitClosed:      false,
  loungeMessage:    true,
  loungeEvent:      true,
  loungeRequest:    false,
  contaKyc:         true,
}

function toNotifState(prefs: NotificationPrefs): NotifState {
  const entries = Object.entries(NOTIF_KEY_MAP) as [keyof NotifState, keyof NotificationPrefs][]
  const result = { ...DEFAULT_NOTIF }
  for (const [uiKey, apiKey] of entries) result[uiKey] = prefs[apiKey]
  return result
}

// ── ToggleRow ─────────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string
  value: boolean
  disabled?: boolean
  onChange?: (v: boolean) => void
}

function ToggleRow({ label, value, disabled = false, onChange }: ToggleRowProps) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{
          false: 'rgba(255,255,255,0.1)',
          true:  colors.state.success,
        }}
        thumbColor={colors.white[100]}
        ios_backgroundColor="rgba(255,255,255,0.1)"
      />
    </View>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

interface SectionProps { title: string; children: React.ReactNode }

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function NotificacoesScreen() {
  const { t }  = useTranslation()
  const token  = useAuthStore(s => s.token)

  const [notif, setNotif] = useState<NotifState>(DEFAULT_NOTIF)
  const [savingKeys, setSavingKeys] = useState<Set<keyof NotifState>>(new Set())

  const [marketingOptIn, setMarketingOptIn]   = useState(false)
  const [marketingSaving, setMarketingSaving] = useState(false)

  useEffect(() => {
    if (!token) return
    authService.fetchUserProfile(token).then(profile => {
      if (!profile) return
      setMarketingOptIn(profile.marketing_opt_in)
      setNotif(toNotifState(profile.notification_prefs))
    })
  }, [token])

  const handleMarketingChange = async (value: boolean) => {
    if (!token || marketingSaving) return
    const previous = marketingOptIn
    setMarketingOptIn(value) // otimista
    setMarketingSaving(true)
    try {
      await authService.updateMarketingOptIn(token, value)
    } catch {
      setMarketingOptIn(previous) // reverte se o back-end recusar
    } finally {
      setMarketingSaving(false)
    }
  }

  const handleToggle = (key: keyof NotifState) => async (value: boolean) => {
    if (!token || savingKeys.has(key)) return
    const previous = notif[key]
    setNotif(prev => ({ ...prev, [key]: value })) // otimista
    setSavingKeys(prev => new Set(prev).add(key))
    try {
      await authService.updateNotificationPrefs(token, { [NOTIF_KEY_MAP[key]]: value })
    } catch {
      setNotif(prev => ({ ...prev, [key]: previous })) // reverte se o back-end recusar
    } finally {
      setSavingKeys(prev => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('perfil.notificacoes.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Transações */}
        <Section title={t('perfil.notificacoes.sectionTransacoes')}>
          <ToggleRow label={t('perfil.notificacoes.txReceive')}     value={notif.txReceive}     disabled={savingKeys.has('txReceive')}     onChange={handleToggle('txReceive')} />
          <ToggleRow label={t('perfil.notificacoes.txSend')}        value={notif.txSend}        disabled={savingKeys.has('txSend')}        onChange={handleToggle('txSend')} />
          <ToggleRow label={t('perfil.notificacoes.txCarregar')}    value={notif.txCarregar}    disabled={savingKeys.has('txCarregar')}    onChange={handleToggle('txCarregar')} />
          <ToggleRow label={t('perfil.notificacoes.txDescarregar')} value={notif.txDescarregar} disabled={savingKeys.has('txDescarregar')} onChange={handleToggle('txDescarregar')} />
        </Section>

        {/* Splits */}
        <Section title={t('perfil.notificacoes.sectionSplits')}>
          <ToggleRow label={t('perfil.notificacoes.splitParticipant')} value={notif.splitParticipant} disabled={savingKeys.has('splitParticipant')} onChange={handleToggle('splitParticipant')} />
          <ToggleRow label={t('perfil.notificacoes.splitExpired')}     value={notif.splitExpired}     disabled={savingKeys.has('splitExpired')}     onChange={handleToggle('splitExpired')} />
          <ToggleRow label={t('perfil.notificacoes.splitClosed')}      value={notif.splitClosed}      disabled={savingKeys.has('splitClosed')}      onChange={handleToggle('splitClosed')} />
        </Section>

        {/* Lounges */}
        <Section title={t('perfil.notificacoes.sectionLounges')}>
          <ToggleRow label={t('perfil.notificacoes.loungeMessage')} value={notif.loungeMessage} disabled={savingKeys.has('loungeMessage')} onChange={handleToggle('loungeMessage')} />
          <ToggleRow label={t('perfil.notificacoes.loungeEvent')}   value={notif.loungeEvent}   disabled={savingKeys.has('loungeEvent')}   onChange={handleToggle('loungeEvent')} />
          <ToggleRow label={t('perfil.notificacoes.loungeRequest')} value={notif.loungeRequest} disabled={savingKeys.has('loungeRequest')} onChange={handleToggle('loungeRequest')} />
        </Section>

        {/* Comunicação de marketing — consentimento separado do aceite obrigatório do cadastro (LGPD) */}
        <Section title={t('perfil.notificacoes.sectionComunicacao')}>
          <ToggleRow
            label={t('perfil.notificacoes.marketingOptIn')}
            value={marketingOptIn}
            disabled={marketingSaving}
            onChange={handleMarketingChange}
          />
          <Text style={styles.secNote}>{t('perfil.notificacoes.marketingOptInNote')}</Text>
        </Section>

        {/* Conta */}
        <Section title={t('perfil.notificacoes.sectionConta')}>
          <ToggleRow label={t('perfil.notificacoes.contaKyc')} value={notif.contaKyc} disabled={savingKeys.has('contaKyc')} onChange={handleToggle('contaKyc')} />
        </Section>

        {/* Segurança — não desabilitáveis */}
        <Section title={t('perfil.notificacoes.sectionSeguranca')}>
          <ToggleRow label={t('perfil.notificacoes.secLogin')}     value={true} disabled />
          <ToggleRow label={t('perfil.notificacoes.secPinChange')} value={true} disabled />
          <ToggleRow label={t('perfil.notificacoes.secBlocked')}   value={true} disabled />
          <Text style={styles.secNote}>{t('perfil.notificacoes.securityNote')}</Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.lg,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.sm,
  },
  sectionBody: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  rowLabel: {
    flex: 1,
    ...typography.size.label,
    color: colors.white[100],
    marginRight: spacing.md,
  },
  rowLabelDisabled: {
    color: 'rgba(255,255,255,0.4)',
  },
  secNote: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.3)',
    marginTop: spacing.sm,
    lineHeight: 17,
  },
})
