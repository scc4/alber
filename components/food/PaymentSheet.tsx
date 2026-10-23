import React from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { foodFont, foodRadius, foodSpace, foodThemes } from '../../tokens/food'
import { AsaasBadge } from '../shared/AsaasBadge'
import { formatAlbers } from './format'
import { FoodButton } from './FoodButton'
import { useFoodTheme } from './FoodTheme'

interface PaymentSheetProps {
  visible: boolean
  total: number
  balance: number
  context: string
  loading?: boolean
  /** Chamado ao confirmar. A autenticação por PIN é responsabilidade de quem chama. */
  onConfirm: () => void
  onTopUp: () => void
  onCancel: () => void
}

export function PaymentSheet({
  visible,
  total,
  balance,
  context,
  loading = false,
  onConfirm,
  onTopUp,
  onCancel,
}: PaymentSheetProps) {
  const { t } = useTranslation()
  const c = useFoodTheme()
  const insufficient = balance < total

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('food.payment.cancel')} />
      <View style={[styles.sheet, { backgroundColor: c.surfaceRaised }]}>
        <View style={[styles.handle, { backgroundColor: c.controlBorder }]} />
        <Text style={[styles.eyebrow, { color: c.inkSubtle }]}>{t('food.payment.title')}</Text>
        <Text style={[styles.total, { color: c.ink }]}>{formatAlbers(total)}</Text>
        <Text style={[styles.context, { color: c.inkMuted }]}>{context}</Text>

        <View style={[styles.line, { borderTopColor: c.line }]}>
          <Text style={[styles.lineLabel, { color: c.inkMuted }]}>{t('food.payment.balanceNow')}</Text>
          <Text style={[styles.lineValue, { color: c.ink }]}>{formatAlbers(balance)}</Text>
        </View>
        <View style={[styles.line, { borderTopColor: c.line }]}>
          <Text style={[styles.lineLabel, { color: c.inkMuted }]}>{t('food.payment.balanceAfter')}</Text>
          <Text style={[styles.lineValue, { color: insufficient ? c.error : c.ink }]}>
            {insufficient ? t('food.payment.insufficient') : formatAlbers(balance - total)}
          </Text>
        </View>

        <View style={styles.actions}>
          {insufficient ? (
            <FoodButton label={t('food.payment.topUp')} onPress={onTopUp} />
          ) : (
            <FoodButton
              label={t('food.payment.pay', { value: formatAlbers(total) })}
              onPress={onConfirm}
              state={loading ? 'loading' : 'default'}
            />
          )}
          <FoodButton label={t('food.payment.cancel')} onPress={onCancel} variant="text" />
        </View>
        <View style={styles.seal}>
          {/* O selo oficial é branco (negativo): sempre sobre fundo escuro, também no tema claro. */}
          <View style={styles.sealBg}>
            <AsaasBadge size="small" />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: foodRadius.xl,
    borderTopRightRadius: foodRadius.xl,
    paddingTop: 12,
    paddingHorizontal: foodSpace.s5,
    paddingBottom: 36,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: foodSpace.s5 },
  eyebrow: { ...foodFont.eyebrow, fontFamily: foodFont.family, textTransform: 'uppercase' },
  total: { ...foodFont.priceLg, fontFamily: foodFont.family, marginTop: foodSpace.s2, fontVariant: ['tabular-nums'] },
  context: { ...foodFont.bodySm, fontFamily: foodFont.family, marginBottom: foodSpace.s5 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: foodSpace.s3, borderTopWidth: 0.5 },
  lineLabel: { ...foodFont.bodySm, fontFamily: foodFont.family },
  lineValue: { ...foodFont.bodySm, fontWeight: '500', fontFamily: foodFont.family, fontVariant: ['tabular-nums'] },
  actions: { marginTop: foodSpace.s5, gap: foodSpace.s2 },
  seal: { marginTop: foodSpace.s4, alignItems: 'center' },
  sealBg: {
    backgroundColor: foodThemes.dark.bg,
    borderRadius: foodRadius.md,
    paddingHorizontal: foodSpace.s3,
    paddingVertical: foodSpace.s2,
  },
})
