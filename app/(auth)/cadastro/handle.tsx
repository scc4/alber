// Design: /design/auth.jsx — StepHandle
// Spec: /specs/06_modules/onboarding.md seção 3.5 — verificação em tempo real, sugestões

import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OnboardShell } from '../../../components/core/OnboardShell'
import { PrimaryButton } from '../../../components/core/PrimaryButton'
import { Eyebrow } from '../../../components/shared/Eyebrow'
import { updateDraft } from '../../../store/signup-draft'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

// Mock: handles já em uso
const TAKEN = new Set(['mayte','alber','admin','joao','test','luiza','ana_silva','pedro'])

type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

function validFormat(h: string) {
  return (
    /^[a-z0-9_]{3,20}$/.test(h) &&
    !h.startsWith('_') &&
    !h.endsWith('_') &&
    !h.includes('__')
  )
}

function buildSuggestions(base: string): string[] {
  const rand = Math.floor(Math.random() * 99)
  return [
    `${base}_${rand}`,
    `${base}real`,
    `the_${base}`,
  ]
    .map(s => s.replace(/[^a-z0-9_]/g, '_').slice(0, 20))
    .filter(s => validFormat(s))
}

export default function HandleScreen() {
  const { t } = useTranslation()
  const [handle, setHandle] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const h = handle.toLowerCase()
    if (!h) { setStatus('idle'); setSuggestions([]); return }
    if (!validFormat(h)) {
      setStatus('invalid')
      setSuggestions([])
      return
    }
    setStatus('checking')
    timer.current = setTimeout(() => {
      if (TAKEN.has(h)) {
        setStatus('taken')
        setSuggestions(buildSuggestions(h))
      } else {
        setStatus('available')
        setSuggestions([])
      }
    }, 500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [handle])

  const borderColor =
    status === 'available'
      ? colors.state.success
      : status === 'taken' || status === 'invalid'
      ? colors.state.error
      : 'rgba(255,255,255,0.18)'

  const hintColor =
    status === 'available'
      ? colors.state.success
      : status === 'taken' || status === 'invalid'
      ? colors.state.error
      : 'rgba(255,255,255,0.38)'

  const hintText = (() => {
    if (status === 'available') return t('auth.onboarding.handle.available')
    if (status === 'taken')    return t('auth.onboarding.handle.taken')
    if (status === 'invalid')  return handle.length < 3
      ? t('auth.onboarding.handle.tooShort')
      : t('auth.onboarding.handle.invalid')
    if (status === 'checking') return t('auth.onboarding.handle.checking')
    return t('auth.onboarding.handle.hint')
  })()

  const handleNext = () => {
    updateDraft({ handle })
    router.push('/(auth)/cadastro/pin')
  }

  return (
    <OnboardShell
      step={2}
      title={t('auth.onboarding.handle.title')}
      subtitle={t('auth.onboarding.handle.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={status === 'available' ? 'default' : 'disabled'}
        />
      }
    >
      {/* Input com @ prefix */}
      <Eyebrow style={styles.inputLabel}>
        {t('auth.onboarding.handle.label')}
      </Eyebrow>
      <View style={[styles.inputRow, { borderBottomColor: borderColor }]}>
        <Text style={styles.atSign}>@</Text>
        <TextInput
          value={handle}
          onChangeText={v =>
            setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))
          }
          placeholder={t('auth.onboarding.handle.placeholder')}
          placeholderTextColor="rgba(255,255,255,0.28)"
          maxLength={20}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={colors.white[100]}
          style={styles.textInput}
        />
        {status === 'checking' && (
          <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
        )}
        {status === 'available' && <Text style={styles.checkIcon}>✓</Text>}
        {(status === 'taken' || status === 'invalid') && (
          <Text style={styles.xIcon}>✕</Text>
        )}
      </View>
      <Text style={[styles.hint, { color: hintColor }]}>{hintText}</Text>

      {/* Sugestões quando handle indisponível */}
      {suggestions.length > 0 && (
        <View style={styles.suggestionsBlock}>
          <Eyebrow style={styles.suggestionsLabel}>
            {t('auth.onboarding.handle.suggestions')}
          </Eyebrow>
          <View style={styles.chips}>
            {suggestions.map(s => (
              <TouchableOpacity
                key={s}
                style={styles.chip}
                onPress={() => setHandle(s)}
                activeOpacity={0.7}
              >
                <Text style={styles.chipText}>@{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  inputLabel: {
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    paddingBottom: 8,
    gap: 4,
  },
  atSign: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '300',
    fontFamily: typography.fontFamily.primary,
  },
  textInput: {
    flex: 1,
    fontSize: 22,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    paddingVertical: 4,
    letterSpacing: -0.01 * 22,
    fontWeight: '500',
  },
  checkIcon: { color: colors.state.success, fontSize: 18 },
  xIcon:     { color: colors.state.error, fontSize: 18 },
  hint: {
    fontSize: 11,
    marginTop: 8,
    fontFamily: typography.fontFamily.primary,
  },
  suggestionsBlock: {
    marginTop: spacing.lg,
  },
  suggestionsLabel: {
    marginBottom: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: spacing.radius.full,
  },
  chipText: {
    fontSize: 13,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
})
