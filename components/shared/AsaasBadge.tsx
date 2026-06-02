// Compliance: Playbook BaaS Asaas — exibição obrigatória em todas as telas financeiras
// Abre https://asaas.com via Linking quando clicado

import { Image, Linking, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

const SELO_URI =
  'https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Negativo-Branco.svg?id=2433cc47-8202-4c46-adf2-1f3175342322'

interface AsaasBadgeProps {
  variant?: 'dark' | 'light'
  size?: 'default' | 'small'
}

export function AsaasBadge({ size = 'default' }: AsaasBadgeProps) {
  const { t } = useTranslation()
  const isSmall = size === 'small'

  const imgWidth  = isSmall ? 90  : 120
  const imgHeight = isSmall ? 27  : 36

  return (
    <Pressable
      onPress={() => Linking.openURL('https://asaas.com')}
      accessibilityRole="link"
      accessibilityLabel={t('shared.asaasBadge')}
      hitSlop={8}
    >
      <Image
        source={{ uri: SELO_URI }}
        style={{ width: imgWidth, height: imgHeight }}
        resizeMode="contain"
        accessibilityLabel={t('shared.asaasBadge')}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({})
