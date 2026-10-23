import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { foodFont, foodSpace } from '../../tokens/food'
import { FoodButton } from './FoodButton'
import { useFoodTheme } from './FoodTheme'

interface FoodEmptyStateProps {
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
}

/** Vazio e erro de lista: uma frase em `title` e uma ação. */
export function FoodEmptyState({ title, message, actionLabel, onAction }: FoodEmptyStateProps) {
  const c = useFoodTheme()

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: c.inkMuted }]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <FoodButton label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: foodSpace.s6, gap: foodSpace.s2 },
  title: { ...foodFont.title, fontFamily: foodFont.family },
  message: { ...foodFont.bodySm, fontFamily: foodFont.family },
  action: { marginTop: foodSpace.s4 },
})
