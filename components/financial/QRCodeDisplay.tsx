// Design: /design/flows1.jsx — QRCodeArt + countdown do CarregarFlow
// Spec: /specs/06_modules/carregar_descarregar.md seção 3.3
// QR placeholder (grid 25×25 com finder patterns) + countdown 30min em tempo real
// Sprint 3: substituir o grid mock por encodedImage retornado pelo BFF (Asaas)

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Constantes ───────────────────────────────────────────────────────────────

const QR_DURATION = 30 * 60  // 1 800 segundos
const GRID_CELLS  = 25
const GRID_SIZE   = 170      // px — espelha o 170×170 do flows1.jsx
const CELL_SIZE   = GRID_SIZE / GRID_CELLS  // 6.8 px

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface QRCodeDisplayProps {
  /** CPF mascarado exibido abaixo do QR, ex: "***.***.456-78" */
  cpfMasked: string
  /** Chamado quando o countdown chega a zero */
  onExpire?: () => void
  /** Chamado ao pressionar "Gerar novo QR Code" (estado expirado) */
  onGenerateNew?: () => void
}

// ─── Gerador de grid ─────────────────────────────────────────────────────────

function generateQRGrid(): number[][] {
  const grid: number[][] = Array.from({ length: GRID_CELLS }, () =>
    Array.from({ length: GRID_CELLS }, () => (Math.random() < 0.46 ? 1 : 0)),
  )

  // Padrão de localização (finder pattern) 7×7 nos três cantos obrigatórios
  const drawFinder = (row: number, col: number) => {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        grid[row + i][col + j] =
          i === 0 || i === 6 || j === 0 || j === 6 ||
          (i >= 2 && i <= 4 && j >= 2 && j <= 4)
            ? 1
            : 0
      }
    }
  }

  drawFinder(0, 0)   // superior esquerdo
  drawFinder(0, 18)  // superior direito
  drawFinder(18, 0)  // inferior esquerdo

  return grid
}

function fmtTime(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function QRCodeDisplay({
  cpfMasked,
  onExpire,
  onGenerateNew,
}: QRCodeDisplayProps) {
  const { t }     = useTranslation()
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const [countdown, setCountdown] = useState(QR_DURATION)

  const cells   = useMemo(generateQRGrid, [])
  const expired  = countdown === 0
  const isWarn   = countdown < 60 && !expired

  // Countdown em tempo real
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1))
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Dispara onExpire uma única vez quando chega a zero
  useEffect(() => {
    if (countdown === 0) {
      if (timerRef.current) clearInterval(timerRef.current)
      onExpire?.()
    }
  }, [countdown, onExpire])

  return (
    <View style={styles.root}>

      {/* Caixa branca do QR — padding lateral cria margem de silêncio (quiet zone) */}
      <View style={styles.qrBox}>
        <View style={[styles.qrGrid, expired && styles.qrGridExpired]}>
          {cells.map((row, i) => (
            <View key={i} style={styles.qrRow}>
              {row.map((v, j) => (
                <View
                  key={j}
                  style={v === 1 ? styles.cellBlack : styles.cellWhite}
                />
              ))}
            </View>
          ))}
        </View>

        {/* Overlay de expirado sobrepõe o grid */}
        {expired && (
          <View style={styles.expiredOverlay}>
            <Text style={styles.expiredIcon}>⌛</Text>
            <Text style={styles.expiredLabel}>
              {t('carregar.qr.expiredLabel')}
            </Text>
          </View>
        )}
      </View>

      {/* Countdown ou botão de regerar */}
      <View style={styles.info}>
        {!expired ? (
          <Text
            style={[styles.countdown, isWarn && styles.countdownWarn]}
            accessibilityLiveRegion="polite"
          >
            {t('carregar.qr.expiresIn', { time: fmtTime(countdown) })}
          </Text>
        ) : (
          <Pressable
            onPress={onGenerateNew}
            style={styles.generateBtn}
            accessibilityRole="button"
            accessibilityLabel={t('carregar.qr.generateNew')}
          >
            <Text style={styles.generateBtnText}>
              {t('carregar.qr.generateNew')}
            </Text>
          </Pressable>
        )}

        <Text style={styles.cpfLabel}>
          {t('carregar.qr.cpfLabel', { cpf: cpfMasked })}
        </Text>
      </View>

    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },

  // Caixa branca (200×200) com padding de 15px — "quiet zone" do QR
  qrBox: {
    width: GRID_SIZE + 30,
    height: GRID_SIZE + 30,
    backgroundColor: colors.white[100],
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },

  // Grid 170×170 de células
  qrGrid: {
    width: GRID_SIZE,
    height: GRID_SIZE,
  },
  qrGridExpired: {
    opacity: 0.18,
  },
  qrRow: {
    flexDirection: 'row',
    height: CELL_SIZE,
  },
  cellBlack: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    backgroundColor: '#000',
  },
  cellWhite: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    backgroundColor: 'transparent',
  },

  // Overlay expirado
  expiredOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  } as const,
  expiredIcon: {
    fontSize: 28,
  },
  expiredLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.black[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -0.1,
  },

  // Info abaixo do QR
  info: {
    marginTop: 18,
    alignItems: 'center',
    gap: 6,
  },
  countdown: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.14,
  },
  countdownWarn: {
    color: colors.warning[500],
  },
  cpfLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.32)',
    fontFamily: typography.fontFamily.primary,
  },

  // Botão "Gerar novo QR Code"
  generateBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: spacing.radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  generateBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -0.1,
  },
})
