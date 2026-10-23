import React from 'react'
import { DimensionValue, View } from 'react-native'
import { foodRadius } from '../../tokens/food'
import { useFoodTheme } from './FoodTheme'

interface FoodSkeletonProps {
  width?: DimensionValue
  height?: number
}

/** Estado de carregamento: bloco estático em surfaceRaised, sem spinner. */
export function FoodSkeleton({ width = '100%', height = 16 }: FoodSkeletonProps) {
  const c = useFoodTheme()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: foodRadius.sm, backgroundColor: c.surfaceRaised }}
    />
  )
}
