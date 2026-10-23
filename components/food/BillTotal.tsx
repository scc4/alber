import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { foodFont, foodRadius, foodSpace } from '../../tokens/food'
import { formatAlbers } from './format'
import { FoodButton } from './FoodButton'
import { FoodSkeleton } from './FoodSkeleton'
import { useFoodTheme } from './FoodTheme'

export type BillTotalState = 'default' | 'loading' | 'error'

export interface BillLine {
  label: string
  value: number
}

interface BillTotalProps {
  total: number
  lines: BillLine[]
  state?: BillTotalState
  onRetry?: () => void
}

/** Não soma: recebe o total e as parcelas já calculados. Taxas ficam em linhas próprias. */
export function BillTotal({ total, lines, state = 'default', onRetry }: BillTotalProps) {
  const { t } = useTranslation()
  const c = useFoodTheme()

  return (
    <View style={[styles.box, { backgroundColor: c.surface }]}>
      <Text style={[styles.eyebrow, { color: c.inkSubtle }]}>{t('food.billTotal.title')}</Text>

      {state === 'loading' && <FoodSkeleton width={160} height={36} />}

      {state === 'error' && (
        <View style={styles.error}>
          <Text style={[styles.errorText, { color: c.error }]}>{t('food.billTotal.error')}</Text>
          {onRetry ? <FoodButton label={t('food.common.retry')} onPress={onRetry} variant="secondary" /> : null}
        </View>
      )}

      {state === 'default' && (
        <>
          <View style={styles.totalRow}>
            <Text style={[styles.total, { color: c.ink }]}>{formatAlbers(total)}</Text>
            <Text style={[styles.unit, { color: c.inkMuted }]}>{t('food.common.albers')}</Text>
          </View>
          {lines.map((line) => (
            <View key={line.label} style={[styles.line, { borderTopColor: c.line }]}>
              <Text style={[styles.lineLabel, { color: c.inkMuted }]}>{line.label}</Text>
              <Text style={[styles.lineValue, { color: c.ink }]}>{formatAlbers(line.value)}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderRadius: foodRadius.md, padding: foodSpace.s4, gap: foodSpace.s2 },
  eyebrow: { ...foodFont.eyebrow, fontFamily: foodFont.family, textTransform: 'uppercase' },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: foodSpace.s1, marginBottom: foodSpace.s2 },
  total: { ...foodFont.priceLg, fontFamily: foodFont.family, fontVariant: ['tabular-nums'] },
  unit: { ...foodFont.bodySm, fontFamily: foodFont.family },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: foodSpace.s2, borderTopWidth: 0.5 },
  lineLabel: { ...foodFont.bodySm, fontFamily: foodFont.family },
  lineValue: { ...foodFont.bodySm, fontWeight: '500', fontFamily: foodFont.family, fontVariant: ['tabular-nums'] },
  error: { gap: foodSpace.s3 },
  errorText: { ...foodFont.bodySm, fontFamily: foodFont.family },
})
