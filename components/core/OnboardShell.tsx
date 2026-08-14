// Shell compartilhado para todas as etapas do onboarding
// Design: /design/auth.jsx — OnboardShell + StepProgress
import React, { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

interface OnboardShellProps {
  step: number          // 0-based
  total?: number
  header?: string       // ex: "CRIAR CONTA"
  title: string
  subtitle?: string
  onBack?: () => void
  children: ReactNode
  footer?: ReactNode
  hideProgress?: boolean // telas fora da contagem numerada (ex: seletor de tipo de conta)
}

export function OnboardShell({
  step,
  total = 6,
  header = 'CRIAR CONTA',
  title,
  subtitle,
  onBack,
  children,
  footer,
  hideProgress = false,
}: OnboardShellProps) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top nav */}
      <View style={styles.topNav}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessible
          accessibilityLabel="Voltar"
          accessibilityRole="button"
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerLabel}>{header}</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={styles.scroll}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Progress bar */}
          {!hideProgress && <StepProgress step={step} total={total} />}

          {/* Title */}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          {/* Content */}
          <View style={styles.content}>{children}</View>

          {/* Footer */}
          {footer ? (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
              {footer}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <View style={progress.row}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            progress.seg,
            i < step
              ? progress.done
              : i === step
              ? progress.active
              : progress.todo,
          ]}
        />
      ))}
      <Text style={progress.count}>{step + 1}/{total}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 36,
    alignItems: 'flex-start',
  },
  backArrow: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 30,
  },
  headerLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.18 * 11,
    textTransform: 'uppercase' as const,
    fontFamily: typography.fontFamily.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 24,
    fontFamily: typography.fontFamily.primary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 19,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  content: {
    flex: 1,
  },
  footer: {
    paddingTop: spacing.md,
  },
})

const progress = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 18,
  },
  seg: {
    height: 3,
    flex: 1,
    borderRadius: 2,
  },
  done: {
    backgroundColor: colors.white[100],
  },
  active: {
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  todo: {
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  count: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.12 * 10,
    marginLeft: 6,
    fontFamily: typography.fontFamily.primary,
  },
})
