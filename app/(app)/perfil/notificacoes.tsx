import React, { useState } from 'react'
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
  const { t } = useTranslation()

  const [notif, setNotif] = useState<NotifState>({
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
  })

  const set = (key: keyof NotifState) => (value: boolean) =>
    setNotif(prev => ({ ...prev, [key]: value }))

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
          <ToggleRow label={t('perfil.notificacoes.txReceive')}     value={notif.txReceive}     onChange={set('txReceive')} />
          <ToggleRow label={t('perfil.notificacoes.txSend')}        value={notif.txSend}        onChange={set('txSend')} />
          <ToggleRow label={t('perfil.notificacoes.txCarregar')}    value={notif.txCarregar}    onChange={set('txCarregar')} />
          <ToggleRow label={t('perfil.notificacoes.txDescarregar')} value={notif.txDescarregar} onChange={set('txDescarregar')} />
        </Section>

        {/* Splits */}
        <Section title={t('perfil.notificacoes.sectionSplits')}>
          <ToggleRow label={t('perfil.notificacoes.splitParticipant')} value={notif.splitParticipant} onChange={set('splitParticipant')} />
          <ToggleRow label={t('perfil.notificacoes.splitExpired')}     value={notif.splitExpired}     onChange={set('splitExpired')} />
          <ToggleRow label={t('perfil.notificacoes.splitClosed')}      value={notif.splitClosed}      onChange={set('splitClosed')} />
        </Section>

        {/* Lounges */}
        <Section title={t('perfil.notificacoes.sectionLounges')}>
          <ToggleRow label={t('perfil.notificacoes.loungeMessage')} value={notif.loungeMessage} onChange={set('loungeMessage')} />
          <ToggleRow label={t('perfil.notificacoes.loungeEvent')}   value={notif.loungeEvent}   onChange={set('loungeEvent')} />
          <ToggleRow label={t('perfil.notificacoes.loungeRequest')} value={notif.loungeRequest} onChange={set('loungeRequest')} />
        </Section>

        {/* Conta */}
        <Section title={t('perfil.notificacoes.sectionConta')}>
          <ToggleRow label={t('perfil.notificacoes.contaKyc')} value={notif.contaKyc} onChange={set('contaKyc')} />
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
