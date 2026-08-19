// Modal de leitura de documento legal (Termos, Privacidade, Transparência).
// Extraído de app/(auth)/cadastro/terms.tsx (item 24) para ser reaproveitado
// em qualquer tela que precise oferecer o conteúdo completo antes de um
// aceite ou apenas como consulta (ex.: Etapa 1 do cadastro, item 24).
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

interface LegalDocModalProps {
  visible: boolean
  title:   string
  body:    string
  onClose: () => void
}

export function LegalDocModal({ visible, title, body, onClose }: LegalDocModalProps) {
  const { t } = useTranslation()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.dismiss} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeLink}>{t('auth.onboarding.terms.close')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={styles.body}>{body}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.black[90],
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.1)',
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  closeLink: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: typography.fontFamily.primary,
  },
  scroll: { flex: 1 },
  body: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 21,
    fontFamily: typography.fontFamily.primary,
  },
})
