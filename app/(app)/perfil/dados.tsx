import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/auth.store'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

interface ProfileData {
  email_masked:   string
  phone_masked:   string
  birth_masked:   string
  pix_key_masked: string
  pix_key_type:   string
}

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
  const { t }  = useTranslation()
  const user   = useAuthStore(s => s.user)
  const token  = useAuthStore(s => s.token)

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [data, setData]         = useState<ProfileData | null>(null)

  const load = async () => {
    if (!token) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`${BFF}/user-profile`, {
        headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
      })
      if (!res.ok) { setError(true); return }
      const json = await res.json()
      setData(json)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token])

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

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
          <Text style={styles.loadingText}>{t('perfil.dados.loading')}</Text>
        </View>
      )}

      {!loading && error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t('perfil.dados.errorLoad')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.75}>
            <Text style={styles.retryText}>{t('perfil.dados.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <DataRow label={t('perfil.dados.name')}    value={user.name} />
          <DataRow label={t('perfil.dados.cpf')}     value={user.cpfMasked || '***.***.***-**'} />
          <DataRow label={t('perfil.dados.birth')}   value={data?.birth_masked ?? '—'} />
          <DataRow label={t('perfil.dados.email')}   value={data?.email_masked ?? '—'} />
          <DataRow label={t('perfil.dados.phone')}   value={data?.phone_masked ?? '—'} />
          <DataRow label={t('perfil.dados.address')} value={t('perfil.dados.addressPlaceholder')} />

          <Text style={styles.readOnly}>{t('perfil.dados.readOnly')}</Text>
        </ScrollView>
      )}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    ...typography.size.caption,
    color: 'rgba(255,255,255,0.4)',
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.size.body,
    color: colors.state.error,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: spacing.radius.sm,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  retryText: {
    ...typography.size.caption,
    color: colors.white[100],
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
