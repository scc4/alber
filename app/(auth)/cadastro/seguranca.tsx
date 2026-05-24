// Design: /design/auth.jsx — StepSecurity
// Spec: /specs/06_modules/onboarding.md seção 3.7 + /specs/05_security.md seção 10
// 4 perguntas distintas obrigatórias — respostas hasheadas antes de armazenar

import { useState } from 'react'
import {
  ScrollView,
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
import { updateDraft } from '../../../store/signup-draft'
import { normalizeSecurityAnswer, sha256Hex } from '../../../utils/crypto'
import { colors } from '../../../tokens/colors'
import { typography } from '../../../tokens/typography'
import { spacing } from '../../../tokens/spacing'

// Lista de perguntas — spec seção 10
const QUESTIONS = [
  'Nome do seu primeiro animal de estimação',
  'Nome da sua avó materna',
  'Nome da sua avó paterna',
  'Cidade onde seus pais se conheceram',
  'Nome do seu melhor amigo da infância',
  'Modelo do primeiro carro da sua família',
  'Nome da rua onde você cresceu',
  'Nome do seu professor favorito do ensino fundamental',
  'Apelido que seus amigos te davam',
  'Nome do seu time favorito quando criança',
]

interface QAItem {
  question: string
  answer: string
}

export default function SegurancaScreen() {
  const { t } = useTranslation()
  const [items, setItems] = useState<QAItem[]>([
    { question: '', answer: '' },
    { question: '', answer: '' },
    { question: '', answer: '' },
    { question: '', answer: '' },
  ])
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const selectedQuestions = items.map(it => it.question).filter(Boolean)

  const updateItem = (i: number, key: keyof QAItem, val: string) => {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [key]: val } : it))
  }

  const availableFor = (i: number) =>
    QUESTIONS.filter(q => q === items[i].question || !selectedQuestions.includes(q))

  const isReady = items.every(it => it.question && it.answer.trim().length >= 2)

  const handleNext = async () => {
    setSaving(true)
    const security = await Promise.all(
      items.map(async it => ({
        question: it.question,
        // Normaliza (lowercase + sem acentos) antes do hash — spec seção 10
        answerHash: await sha256Hex(normalizeSecurityAnswer(it.answer)),
      }))
    )
    updateDraft({ security })
    router.push('/(auth)/cadastro/pix')
  }

  return (
    <OnboardShell
      step={4}
      title={t('auth.onboarding.seguranca.title')}
      subtitle={t('auth.onboarding.seguranca.subtitle')}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={t('auth.onboarding.continue')}
          onPress={handleNext}
          state={isReady ? (saving ? 'loading' : 'default') : 'disabled'}
        />
      }
    >
      <View style={styles.list}>
        {items.map((it, i) => {
          const isOpen = openIdx === i
          const available = availableFor(i)

          return (
            <View key={i} style={styles.card}>
              <Text style={styles.cardLabel}>
                {t('auth.onboarding.seguranca.questionLabel', { n: i + 1 })}
              </Text>

              {/* Dropdown */}
              <TouchableOpacity
                style={styles.dropdownTrigger}
                onPress={() => setOpenIdx(isOpen ? null : i)}
                activeOpacity={0.7}
              >
                <Text style={[styles.dropdownText, !it.question && styles.dropdownPlaceholder]}>
                  {it.question || t('auth.onboarding.seguranca.selectQuestion')}
                </Text>
                <Text style={[styles.chevron, { transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }]}>
                  ⌄
                </Text>
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.dropdown}>
                  {available.map(q => (
                    <TouchableOpacity
                      key={q}
                      style={[styles.dropdownOption, q === it.question && styles.dropdownOptionSelected]}
                      onPress={() => { updateItem(i, 'question', q); setOpenIdx(null) }}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.dropdownOptionText,
                        q === it.question && styles.dropdownOptionTextSelected,
                      ]}>
                        {q}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Resposta — só aparece quando pergunta selecionada */}
              {it.question ? (
                <TextInput
                  value={it.answer}
                  onChangeText={v => updateItem(i, 'answer', v)}
                  placeholder={t('auth.onboarding.seguranca.answerPlaceholder')}
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  selectionColor={colors.white[100]}
                  maxLength={50}
                  style={styles.answerInput}
                />
              ) : null}
            </View>
          )
        })}
      </View>
    </OnboardShell>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: 14,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: spacing.radius.md,
    padding: 14,
    paddingHorizontal: 16,
  },
  cardLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: 8,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  dropdownText: {
    flex: 1,
    fontSize: 14,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  dropdownPlaceholder: {
    color: 'rgba(255,255,255,0.4)',
  },
  chevron: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
  dropdown: {
    marginTop: 10,
    marginBottom: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  dropdownOption: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  dropdownOptionSelected: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  dropdownOptionText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: typography.fontFamily.primary,
  },
  dropdownOptionTextSelected: {
    color: colors.white[100],
  },
  answerInput: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
    paddingBottom: 6,
    marginTop: 8,
    fontSize: 14,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
})
