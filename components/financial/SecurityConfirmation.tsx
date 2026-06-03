// Spec: /specs/05_security.md seção 3 — Confirmação de segurança
// Design: /design/pin.jsx — SecurityConfirm
// Sorteia 1 de N perguntas, exibe 4 opções mascaradas (1 correta + 3 falsas)

import React, { useRef, useState } from 'react'
import {
  Animated,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { PrimaryButton } from '../core/PrimaryButton'
import { useTranslation } from 'react-i18next'
import { maskAnswer, sha256Hex, normalizeSecurityAnswer } from '../../utils/crypto'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// Pool de respostas falsas para completar as 4 opções (mock)
const MOCK_FAKES = [
  'Rex', 'Luna', 'Tobias', 'Mel', 'Bolinha',
  'Nina', 'Thor', 'Lola', 'Max', 'Princesa',
  'Simba', 'Bidu',
]

export interface SecurityQuestion {
  question: string
  /** Resposta em texto puro — mascarada internamente. Ausente quando vinda do backend (TextInput mode). */
  answer?: string
}

export interface SecurityConfirmationProps {
  /** 1-4 perguntas cadastradas. O componente sorteia 1. Omitir usa MOCK_SECURITY_QUESTIONS. */
  questions?: SecurityQuestion[]
  /** Recebe o SHA-256(normalizeSecurityAnswer(answer)) para envio ao BFF. */
  onPass: (answerHash?: string) => void
  onFail?: (attemptsLeft: number) => void
  onBlocked?: () => void
  maxAttempts?: number
}

function shuffle<T>(arr: T[]): T[] {
  const b = [...arr]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

// Gera 3 falsas que não conflitem com a correta
function buildFakes(correct: string, pool: string[]): string[] {
  const masked = maskAnswer(correct)
  const candidates = pool
    .filter(f => f !== correct && maskAnswer(f) !== masked)
    .map(f => maskAnswer(f))
  return shuffle([...new Set(candidates)]).slice(0, 3)
}

export function SecurityConfirmation({
  questions = MOCK_SECURITY_QUESTIONS,
  onPass,
  onFail,
  onBlocked,
  maxAttempts = 3,
}: SecurityConfirmationProps) {
  const { t } = useTranslation()

  // Sorteia 1 pergunta. Se tiver answer → multiple-choice. Sem answer → TextInput.
  const [{ questionText, maskedCorrect, correctAnswer, options }] = useState(() => {
    const q = questions[Math.floor(Math.random() * questions.length)]
    if (!q.answer) {
      return { questionText: q.question, maskedCorrect: null as string | null, correctAnswer: undefined as string | undefined, options: [] as string[] }
    }
    const masked = maskAnswer(q.answer)
    const fakes = buildFakes(q.answer, MOCK_FAKES)
    return {
      questionText:  q.question,
      maskedCorrect: masked as string | null,
      correctAnswer: q.answer as string | undefined,
      options:       shuffle([masked, ...fakes]),
    }
  })

  // Multiple-choice state
  const [selected, setSelected] = useState<number | null>(null)
  const [wrong, setWrong] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const shakeX = useRef(new Animated.Value(0)).current

  // TextInput state
  const [textAnswer, setTextAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start()
  }

  const pick = (idx: number) => {
    if (selected !== null) return
    setSelected(idx)

    const isCorrect = options[idx] === maskedCorrect
    setTimeout(() => {
      if (isCorrect) {
        sha256Hex(normalizeSecurityAnswer(correctAnswer!)).then(hash => onPass(hash))
      } else {
        const next = attempts + 1
        setAttempts(next)
        shake()
        setWrong(true)
        setTimeout(() => {
          setSelected(null)
          setWrong(false)
          if (next >= maxAttempts) {
            onBlocked?.()
          } else {
            onFail?.(maxAttempts - next)
          }
        }, 900)
      }
    }, 280)
  }

  // ── TextInput mode (perguntas reais sem answer_text) ──────────────────────

  if (!correctAnswer) {
    const canSubmit = textAnswer.trim().length >= 2 && !submitting

    const handleSubmit = async () => {
      if (!canSubmit) return
      setSubmitting(true)
      try {
        const hash = await sha256Hex(normalizeSecurityAnswer(textAnswer))
        onPass(hash)
      } finally {
        setSubmitting(false)
      }
    }

    return (
      <View style={styles.root}>
        <Text style={styles.eyebrow}>{t('auth.security.header')}</Text>
        <Text style={styles.title}>{t('auth.security.title')}</Text>
        <Text style={styles.question}>{questionText}</Text>
        <TextInput
          style={styles.textInput}
          value={textAnswer}
          onChangeText={setTextAnswer}
          placeholder={t('auth.login.securityAnswerPlaceholder')}
          placeholderTextColor="rgba(255,255,255,0.25)"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={canSubmit ? handleSubmit : undefined}
          accessibilityLabel={questionText}
        />
        <Text style={styles.textHint}>{t('auth.login.securityHint')}</Text>
        <View style={styles.textSubmitWrap}>
          <PrimaryButton
            label={t('auth.security.confirm')}
            onPress={handleSubmit}
            state={submitting ? 'loading' : canSubmit ? 'default' : 'disabled'}
          />
        </View>
      </View>
    )
  }

  // ── Multiple-choice mode ──────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>{t('auth.security.header')}</Text>
      <Text style={styles.title}>{t('auth.security.title')}</Text>
      <Text style={styles.question}>{questionText}</Text>

      {attempts > 0 && (
        <Text style={styles.attemptHint}>
          {t('auth.security.attempt', { n: attempts + 1, max: maxAttempts })}
        </Text>
      )}

      <Animated.View style={[styles.optionsList, { transform: [{ translateX: shakeX }] }]}>
        {options.map((opt, i) => {
          const isSelected = selected === i
          const isWrong = isSelected && wrong

          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.option,
                isSelected && !wrong && styles.optionSelected,
                isWrong && styles.optionWrong,
              ]}
              onPress={() => pick(i)}
              activeOpacity={0.7}
              accessible
              accessibilityRole="button"
              accessibilityLabel={opt}
              accessibilityState={{ selected: isSelected }}
            >
              <Text style={[styles.optionText, isWrong && styles.optionTextWrong]}>
                {opt}
              </Text>
            </TouchableOpacity>
          )
        })}
      </Animated.View>
    </View>
  )
}

// ─── Mock questions para desenvolvimento ─────────────────────────────────────
// Em produção: virão do backend após autenticação da sessão

export const MOCK_SECURITY_QUESTIONS: SecurityQuestion[] = [
  { question: 'Nome do seu primeiro animal de estimação', answer: 'Bolinha' },
  { question: 'Nome da sua avó materna', answer: 'Maria Silva' },
  { question: 'Cidade onde seus pais se conheceram', answer: 'Santos' },
  { question: 'Nome do seu melhor amigo da infância', answer: 'Rodrigo' },
]

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: spacing.sm,
  },
  eyebrow: {
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: typography.eyebrow.textTransform,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: typography.size.h1.fontSize,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.015 * typography.size.h1.fontSize,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  question: {
    fontSize: typography.size.label.fontSize,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: typography.size.label.lineHeight,
    marginBottom: spacing.lg,
  },
  attemptHint: {
    fontSize: typography.size.micro.fontSize,
    color: colors.warning[500],
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.md,
  },
  optionsList: {
    gap: 10,
  },
  option: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: spacing.radius.md,
    padding: 18,
    paddingHorizontal: 20,
  },
  optionSelected: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  optionWrong: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderColor: 'rgba(239,68,68,0.3)',
  },
  optionText: {
    fontSize: 15,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  optionTextWrong: {
    color: colors.state.error,
  },

  // TextInput mode
  textInput: {
    width: '100%',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.18)',
    paddingVertical: spacing.sm + 2,
    fontSize: 18,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  textHint: {
    fontSize: typography.size.caption.fontSize,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: typography.fontFamily.primary,
    lineHeight: typography.size.caption.lineHeight,
    marginBottom: spacing.lg,
  },
  textSubmitWrap: {
    marginTop: 'auto' as any,
  },
})
