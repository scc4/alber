// Spec: /specs/04_api_asaas.md §4.7 — KYC via WebView interno (White Label)
// Abre URL de onboarding da subconta Asaas dentro do app, sem browser externo.

import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

interface WebViewModalProps {
  visible:  boolean
  url:      string
  title:    string
  onClose:  () => void
}

export function WebViewModal({ visible, url, title, onClose }: WebViewModalProps) {
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)

  // Reinicia o indicador de carregamento toda vez que o modal abre
  useEffect(() => {
    if (visible) setLoading(true)
  }, [visible])

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            style={styles.closeBtn}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        {/* WebView + loading overlay */}
        <View style={styles.webviewContainer}>
          {!!url && (
            <WebView
              source={{ uri: url }}
              style={styles.webview}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              javaScriptEnabled
              domStorageEnabled
            />
          )}

          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color={colors.white[100]} size="large" />
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    flex: 1,
    fontSize: typography.size.label.fontSize,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 0.2,
  },
  closeBtn: {
    marginLeft: spacing.md,
  },
  closeBtnText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
  },
  webviewContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.black[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
})
