import React from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/auth.store'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

// Dados mascarados conforme /specs/05_security.md §6.3
// Em produção, vêm do BFF já mascarados — nunca dados completos no app
const MOCK_BIRTH   = '**/07/19**'
const MOCK_EMAIL   = 'ma***@email.com'
const MOCK_PHONE   = '(11) ****-1234'
const MOCK_ADDRESS = 'Rua ***, 000 — São Paulo, SP'

// ── DataRow ───────────────────────────────────────────────────────────────────

interface DataRowProps { label: string; value: string }

function DataRow({ label, value }: DataRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function DadosScreen() {
  const { t } = useTranslation()
  const user  = useAuthStore(s => s.user)

  if (!user) return null

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('perfil.dados.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <DataRow label={t('perfil.dados.name')}    value={user.name} />
        <DataRow label={t('perfil.dados.cpf')}     value={user.cpfMasked} />
        <DataRow label={t('perfil.dados.birth')}   value={MOCK_BIRTH} />
        <DataRow label={t('perfil.dados.email')}   value={MOCK_EMAIL} />
        <DataRow label={t('perfil.dados.phone')}   value={MOCK_PHONE} />
        <DataRow label={t('perfil.dados.address')} value={MOCK_ADDRESS} />

        <Text style={styles.readOnly}>{t('perfil.dados.readOnly')}</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 32,
  },
  backIcon: {
    fontSize: 20,
    color: colors.white[100],
  },
  title: {
    ...typography.size.label,
    fontWeight: typography.weight.bold,
    color: colors.white[100],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  row: {
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowLabel: {
    ...typography.eyebrow,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 6,
  },
  rowValue: {
    ...typography.size.body,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
  },
  readOnly: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.3)',
    marginTop: spacing.xl,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
})
