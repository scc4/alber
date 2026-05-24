import React from 'react'
import { StyleSheet, View, ViewStyle } from 'react-native'

interface RuleProps {
  style?: ViewStyle
}

export function Rule({ style }: RuleProps) {
  return <View style={[styles.base, style]} />
}

const styles = StyleSheet.create({
  base: {
    height:          0.5,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
})
