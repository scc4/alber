// Spec: /specs/05_security.md seção 2 — PIN scrambled par-a-par
// Design: /design/pin.jsx — PinKbPairGrid + PinKbArc (split buttons)
// CRÍTICO: nunca expor dígitos individuais fora do hash; screenshot bloqueada

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { usePreventScreenCapture } from 'expo-screen-capture'
import { sha256Hex } from '../../utils/crypto'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// Pares fixos conforme spec seção 2.1
// Posições são randomizadas a cada render (não os pares em si)
const PAIRS: readonly [number, number][] = [
  [0, 2],
  [4, 6],
  [5, 7],
  [8, 9],
  [1, 3],
]

// Sequências obviamente inseguras — rejeitadas na criação (spec ON-04)
const OBVIOUS = new Set([
  '111111', '222222', '333333', '444444', '555555',
  '666666', '777777', '888888', '999999', '000000',
  '123456', '654321', '012345',
])

function shufflePairs(arr: readonly [number, number][]): [number, number][] {
  const b = [...arr] as [number, number][]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

export interface PINInputProps {
  /** Chamado com SHA-256(digits) quando 6 dígitos são inseridos */
  onComplete: (hash: string) => void
  /** Rejeita sequências óbvias (usar na criação de PIN) */
  checkObvious?: boolean
  onObvious?: () => void
  /** Mensagem de erro externo — dispara shake */
  error?: string | null
  disabled?: boolean
}

export function PINInput({
  onComplete,
  checkObvious = false,
  onObvious,
  error,
  disabled = false,
}: PINInputProps) {
  // Bloqueia screenshots — spec seção 2, /specs/05_security.md
  usePreventScreenCapture()

  const [digits, setDigits] = useState<number[]>([])
  const [layout, setLayout] = useState<[number, number][]>(() => shufflePairs(PAIRS))
  const shakeX = useRef(new Animated.Value(0)).current

  // Reshuffle a cada mount — posições diferentes toda vez
  useEffect(() => {
    setLayout(shufflePairs(PAIRS))
  }, [])

  // Shake nos dots quando chega erro externo
  useEffect(() => {
    if (!error) return
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start()
  }, [error, shakeX])

  const press = useCallback(
    (digit: number) => {
      if (disabled || digits.length >= 6) return
      const next = [...digits, digit]
      setDigits(next)

      if (next.length === 6) {
        const seq = next.join('')
        if (checkObvious && OBVIOUS.has(seq)) {
          onObvious?.()
          setTimeout(() => setDigits([]), 350)
          return
        }
        // Hash SHA-256 antes de chamar parent — nunca expor dígitos puros
        sha256Hex(seq).then(hash => {
          onComplete(hash)
          setTimeout(() => setDigits([]), 400)
        })
      }
    },
    [digits, disabled, checkObvious, onObvious, onComplete],
  )

  const backspace = useCallback(() => {
    if (disabled) return
    setDigits(d => d.slice(0, -1))
  }, [disabled])

  const row1 = layout.slice(0, 3)
  const row2 = layout.slice(3, 5)

  return (
    <View style={styles.root}>
      {/* Indicador de segurança */}
      <View style={styles.lockRow}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockLabel}>SCREENSHOT BLOQUEADA</Text>
      </View>

      {/* 6 progress dots */}
      <Animated.View style={[styles.dots, { transform: [{ translateX: shakeX }] }]}>
        {Array.from({ length: 6 }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, digits.length > i ? styles.dotOn : styles.dotOff]}
          />
        ))}
      </Animated.View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Teclado scrambled — linha 1 */}
      <View style={styles.kbRow}>
        {row1.map((pair, i) => (
          <PairKey key={i} pair={pair} onPress={press} disabled={disabled} />
        ))}
      </View>

      {/* Teclado scrambled — linha 2: 2 pares + backspace */}
      <View style={styles.kbRow}>
        {row2.map((pair, i) => (
          <PairKey key={i + 3} pair={pair} onPress={press} disabled={disabled} />
        ))}
        <BackspaceKey onPress={backspace} disabled={disabled} />
      </View>
    </View>
  )
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────

interface PairKeyProps {
  pair: [number, number]
  onPress: (digit: number) => void
  disabled: boolean
}

function PairKey({ pair, onPress, disabled }: PairKeyProps) {
  return (
    <View style={styles.cell}>
      <TouchableOpacity
        style={styles.half}
        onPress={() => onPress(pair[0])}
        disabled={disabled}
        activeOpacity={0.55}
        accessible
        accessibilityLabel={`Dígito ${pair[0]}`}
        accessibilityRole="button"
      >
        <Text style={styles.digitText}>{pair[0]}</Text>
      </TouchableOpacity>

      <View style={styles.cellDivider} />

      <TouchableOpacity
        style={styles.half}
        onPress={() => onPress(pair[1])}
        disabled={disabled}
        activeOpacity={0.55}
        accessible
        accessibilityLabel={`Dígito ${pair[1]}`}
        accessibilityRole="button"
      >
        <Text style={styles.digitText}>{pair[1]}</Text>
      </TouchableOpacity>
    </View>
  )
}

function BackspaceKey({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.cell, styles.bsCell]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.55}
      accessible
      accessibilityLabel="Apagar"
      accessibilityRole="button"
    >
      {/* Ícone de backspace inline — sem dependência de svg lib */}
      <Text style={styles.bsText}>⌫</Text>
    </TouchableOpacity>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CELL_HEIGHT = 56
const ROW_GAP = 9

const styles = StyleSheet.create({
  root: {
    width: '100%',
    gap: ROW_GAP,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 2,
  },
  lockIcon: {
    fontSize: 11,
  },
  lockLabel: {
    fontSize: 10,
    color: 'rgba(34,197,94,0.7)',
    letterSpacing: 1.2,
    fontFamily: typography.fontFamily.primary,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginVertical: spacing.lg,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  dotOn: {
    backgroundColor: colors.white[100],
    borderWidth: 1.5,
    borderColor: colors.white[100],
  },
  dotOff: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  errorText: {
    fontSize: typography.size.caption.fontSize,
    color: colors.state.error,
    textAlign: 'center',
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily.primary,
  },
  kbRow: {
    flexDirection: 'row',
    gap: ROW_GAP,
  },
  cell: {
    flex: 1,
    height: CELL_HEIGHT,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: spacing.radius.md,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  half: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellDivider: {
    width: 0.5,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginVertical: 12,
  },
  digitText: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  bsCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bsText: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.55)',
  },
})
