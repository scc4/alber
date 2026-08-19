// Spec: /specs/05_security.md seção 2 — PIN scrambled par-a-par
// Design: /design/pin.jsx — PinKbPairGrid (secure) | PinKbSetup (setup)
// CRÍTICO: nunca expor dígitos individuais fora do hash; screenshot bloqueada

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { usePreventScreenCapture } from 'expo-screen-capture'
import { sha256Hex, legacyDevHash } from '../../utils/crypto'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// Sequências obviamente inseguras — rejeitadas na criação (spec ON-04)
const OBVIOUS = new Set([
  '111111', '222222', '333333', '444444', '555555',
  '666666', '777777', '888888', '999999', '000000',
  '123456', '654321', '012345',
])

// ── Geradores de layout ───────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const b = [...arr]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

/**
 * Modo 'secure': 5 pares embaralhados com ordem interna aleatória.
 * Cada press escolhe aleatoriamente um dos dois dígitos do par.
 */
function generatePairs(): [number, number][] {
  const digits = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  const pairs: [number, number][] = []
  for (let i = 0; i < 10; i += 2) {
    pairs.push(
      Math.random() < 0.5
        ? [digits[i], digits[i + 1]]
        : [digits[i + 1], digits[i]],
    )
  }
  return shuffle(pairs) as [number, number][]
}

/**
 * Modo 'setup': 10 dígitos em posições aleatórias.
 * O usuário vê e escolhe o número exato.
 */
function generateShuffledDigits(): number[] {
  return shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
}

// ── Interface pública ─────────────────────────────────────────────────────────

export interface PINInputProps {
  /** Chamado com SHA-256(digits) quando 6 dígitos são inseridos */
  onComplete:    (hash: string) => void
  /**
   * 'secure' (padrão) — pares ambíguos, escolha aleatória, re-embaralha a cada toque.
   *   Usar em: login, transferir, carregar/descarregar, receber.
   * 'setup' — dígitos individuais visíveis, posições embaralhadas no mount.
   *   Usar em: cadastro, recuperação e troca de PIN.
   */
  mode?:         'secure' | 'setup'
  /** Rejeita sequências óbvias (usar na criação de PIN) */
  checkObvious?: boolean
  onObvious?:    () => void
  /** PINs extras de 6 dígitos a rejeitar junto com OBVIOUS (ex.: combinações da data de nascimento) — só considerado quando checkObvious=true */
  forbidden?:    string[]
  /** Mensagem de erro externo — dispara shake */
  error?:        string | null
  disabled?:     boolean
  /** Inclui hash legado no payload — somente no fluxo de migração de contas antigas */
  legacyCompat?: boolean
}

// ── Componente principal ──────────────────────────────────────────────────────

export function PINInput({
  onComplete,
  mode          = 'secure',
  checkObvious  = false,
  onObvious,
  forbidden     = [],
  error,
  disabled      = false,
  legacyCompat  = false,
}: PINInputProps) {
  // Setup: acumula dígitos reais para hash SHA-256
  const [digits,       setDigits]       = useState<number[]>([])
  // Secure: acumula os pares clicados para envio ao backend
  const [clickedPairs, setClickedPairs] = useState<[number, number][]>([])

  const [securePairs, setSecurePairs] = useState<[number, number][]>(() => generatePairs())
  const [setupKeys,   setSetupKeys]   = useState<number[]>(() => generateShuffledDigits())
  const shakeX = useRef(new Animated.Value(0)).current

  // Android: bloqueia captura de tela de verdade (FLAG_SECURE) enquanto o PIN
  // está na tela — sem isso a mensagem "SCREENSHOT BLOQUEADA" abaixo era só
  // decorativa. iOS não expõe API pra bloquear screenshot comum (limitação da
  // Apple, não deste app) — aqui o hook ao menos escurece a tela durante
  // gravação de tela.
  usePreventScreenCapture()

  const entryCount = mode === 'secure' ? clickedPairs.length : digits.length

  useEffect(() => {
    if (mode === 'secure') setSecurePairs(generatePairs())
    else                   setSetupKeys(generateShuffledDigits())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!error) return
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 10,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8,   duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0,   duration: 55, useNativeDriver: true }),
    ]).start()
  }, [error, shakeX])

  // ── Modo secure: registra o PAR inteiro, envia JSON dos pares ao completar ──
  const pressSecure = useCallback(
    (pair: [number, number]) => {
      if (disabled || clickedPairs.length >= 6) return
      const next = [...clickedPairs, pair]
      setClickedPairs(next)

      if (next.length === 6) {
        onComplete(JSON.stringify(next))
        // Regenera pares apenas para a próxima tentativa (não a cada toque)
        setTimeout(() => { setClickedPairs([]); setSecurePairs(generatePairs()) }, 400)
      }
    },
    [clickedPairs, disabled, onComplete],
  )

  // ── Modo setup: registra dígito exato, envia SHA-256 ao completar ───────────
  const pressSetup = useCallback(
    (digit: number) => {
      if (disabled || digits.length >= 6) return
      const next = [...digits, digit]
      setDigits(next)

      if (next.length === 6) {
        const seq = next.join('')
        if (checkObvious && (OBVIOUS.has(seq) || forbidden.includes(seq))) {
          onObvious?.()
          setTimeout(() => { setDigits([]); setSetupKeys(generateShuffledDigits()) }, 350)
          return
        }
        sha256Hex(seq).then(hash => {
          const payload = legacyCompat
            ? JSON.stringify({ sha256: hash, legacy: legacyDevHash(seq) })
            : hash
          onComplete(payload)
          setTimeout(() => { setDigits([]); setSetupKeys(generateShuffledDigits()) }, 400)
        })
      }
    },
    [digits, disabled, checkObvious, forbidden, onObvious, onComplete],
  )

  const backspace = useCallback(() => {
    if (disabled) return
    if (mode === 'secure') {
      setClickedPairs(p => p.slice(0, -1))
    } else {
      setDigits(d => d.slice(0, -1))
    }
  }, [disabled, mode])

  return (
    <View style={styles.root}>
      {Platform.OS === 'ios' && (
        <TextInput
          secureTextEntry
          editable={false}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={styles.hiddenSecureInput}
        />
      )}

      <View style={styles.lockRow}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockLabel}>SCREENSHOT BLOQUEADA</Text>
      </View>

      <Animated.View style={[styles.dots, { transform: [{ translateX: shakeX }] }]}>
        {Array.from({ length: 6 }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, entryCount > i ? styles.dotOn : styles.dotOff]}
          />
        ))}
      </Animated.View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {mode === 'secure'
        ? (
          <SecureKeyboard
            pairs={securePairs}
            onPress={pressSecure}
            onBackspace={backspace}
            disabled={disabled}
          />
        )
        : (
          <SetupKeyboard
            keys={setupKeys}
            onPress={pressSetup}
            onBackspace={backspace}
            disabled={disabled}
          />
        )
      }
    </View>
  )
}

// ── SecureKeyboard — 5 pares "X ou Y" (2×2 + 1 centralizado) ─────────────────

interface SecureKeyboardProps {
  pairs:       [number, number][]
  onPress:     (pair: [number, number]) => void
  onBackspace: () => void
  disabled:    boolean
}

function SecureKeyboard({ pairs, onPress, onBackspace, disabled }: SecureKeyboardProps) {
  return (
    <>
      <View style={styles.kbRow}>
        <PairKey pair={pairs[0]} onPress={onPress} disabled={disabled} />
        <PairKey pair={pairs[1]} onPress={onPress} disabled={disabled} />
      </View>
      <View style={styles.kbRow}>
        <PairKey pair={pairs[2]} onPress={onPress} disabled={disabled} />
        <PairKey pair={pairs[3]} onPress={onPress} disabled={disabled} />
      </View>
      {/* placeholder | par5 centralizado | backspace */}
      <View style={styles.kbRow}>
        <View style={styles.cellPlaceholder} />
        <PairKey pair={pairs[4]} onPress={onPress} disabled={disabled} />
        <BackspaceKey onPress={onBackspace} disabled={disabled} />
      </View>
    </>
  )
}

// ── SetupKeyboard — 10 dígitos individuais (3×3 + 0 + backspace) ─────────────

interface SetupKeyboardProps {
  keys:        number[]
  onPress:     (digit: number) => void
  onBackspace: () => void
  disabled:    boolean
}

function SetupKeyboard({ keys, onPress, onBackspace, disabled }: SetupKeyboardProps) {
  return (
    <>
      <View style={styles.kbRow}>
        <SingleKey digit={keys[0]} onPress={onPress} disabled={disabled} />
        <SingleKey digit={keys[1]} onPress={onPress} disabled={disabled} />
        <SingleKey digit={keys[2]} onPress={onPress} disabled={disabled} />
      </View>
      <View style={styles.kbRow}>
        <SingleKey digit={keys[3]} onPress={onPress} disabled={disabled} />
        <SingleKey digit={keys[4]} onPress={onPress} disabled={disabled} />
        <SingleKey digit={keys[5]} onPress={onPress} disabled={disabled} />
      </View>
      <View style={styles.kbRow}>
        <SingleKey digit={keys[6]} onPress={onPress} disabled={disabled} />
        <SingleKey digit={keys[7]} onPress={onPress} disabled={disabled} />
        <SingleKey digit={keys[8]} onPress={onPress} disabled={disabled} />
      </View>
      {/* placeholder | dígito central | backspace */}
      <View style={styles.kbRow}>
        <View style={styles.cellPlaceholder} />
        <SingleKey digit={keys[9]} onPress={onPress} disabled={disabled} />
        <BackspaceKey onPress={onBackspace} disabled={disabled} />
      </View>
    </>
  )
}

// ── Teclas ────────────────────────────────────────────────────────────────────

interface PairKeyProps {
  pair:     [number, number]
  onPress:  (pair: [number, number]) => void
  disabled: boolean
}

function PairKey({ pair, onPress, disabled }: PairKeyProps) {
  return (
    <TouchableOpacity
      style={styles.cell}
      onPress={() => onPress(pair)}
      disabled={disabled}
      activeOpacity={0.55}
      accessible
      accessibilityLabel={`${pair[0]} ou ${pair[1]}`}
      accessibilityRole="button"
    >
      <Text style={styles.pairText}>{pair[0]} ou {pair[1]}</Text>
    </TouchableOpacity>
  )
}

interface SingleKeyProps {
  digit:    number
  onPress:  (digit: number) => void
  disabled: boolean
}

function SingleKey({ digit, onPress, disabled }: SingleKeyProps) {
  return (
    <TouchableOpacity
      style={styles.cell}
      onPress={() => onPress(digit)}
      disabled={disabled}
      activeOpacity={0.55}
      accessible
      accessibilityLabel={String(digit)}
      accessibilityRole="button"
    >
      <Text style={styles.singleText}>{digit}</Text>
    </TouchableOpacity>
  )
}

function BackspaceKey({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <TouchableOpacity
      style={styles.cell}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.55}
      accessible
      accessibilityLabel="Apagar"
      accessibilityRole="button"
    >
      <Text style={styles.bsText}>⌫</Text>
    </TouchableOpacity>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CELL_HEIGHT = 60
const ROW_GAP     = 9

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
  lockIcon: { fontSize: 11 },
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPlaceholder: {
    flex: 1,
  },
  pairText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 0.5,
  },
  singleText: {
    fontSize: 22,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  bsText: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.55)',
  },
  hiddenSecureInput: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
})
