// Campo de texto padronizado — usado em todas as telas de auth
// Design: /design/auth.jsx — componente Field
import React, { ReactNode } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string
  error?: string | null
  hint?: string | null
  success?: boolean
  loading?: boolean
  right?: ReactNode
}

export function Field({
  label,
  error,
  hint,
  success,
  loading,
  right,
  ...inputProps
}: FieldProps) {
  const borderColor = error
    ? colors.state.error
    : success
    ? colors.state.success
    : 'rgba(255,255,255,0.18)'

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, { borderBottomColor: borderColor }]}>
        <TextInput
          placeholderTextColor="rgba(255,255,255,0.28)"
          selectionColor={colors.white[100]}
          {...inputProps}
          style={[styles.input, inputProps.readOnly && styles.readOnly]}
        />
        {loading && <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />}
        {success && !loading && <Text style={styles.successIcon}>✓</Text>}
        {!loading && !success && right}
      </View>
      {(error || hint) ? (
        <Text style={[styles.helper, error ? styles.helperError : styles.helperHint]}>
          {error ?? hint}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 18,
  },
  label: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.42)',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    paddingBottom: 6,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    paddingVertical: 4,
    letterSpacing: -0.01 * 16,
  },
  readOnly: {
    color: 'rgba(255,255,255,0.55)',
  },
  successIcon: {
    color: colors.state.success,
    fontSize: 18,
    marginLeft: spacing.xs,
  },
  helper: {
    fontSize: 11,
    marginTop: 6,
    lineHeight: 15,
    fontFamily: typography.fontFamily.primary,
  },
  helperError: {
    color: colors.state.error,
  },
  helperHint: {
    color: 'rgba(255,255,255,0.38)',
  },
})
