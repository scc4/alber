// Compliance: Playbook BaaS Asaas — exibição obrigatória em todas as telas
// financeiras e, especialmente, nas telas de criação de subconta.
// Abre https://asaas.com via Linking quando clicado.
//
// O selo é servido pelo CDN oficial do Asaas como .svg — o componente <Image>
// do React Native NÃO renderiza SVG remoto (só rasterizado), por isso o selo
// usa <SvgUri> do react-native-svg, que baixa e desenha o XML do selo.
// Proporção do arquivo oficial (viewBox 188x69) preservada nos tamanhos abaixo.

import { Linking, Pressable } from 'react-native'
import { SvgUri } from 'react-native-svg'
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

  const imgWidth  = isSmall ? 90  : 130
  const imgHeight = isSmall ? 33  : 48

  return (
    <Pressable
      onPress={() => Linking.openURL('https://asaas.com')}
      accessibilityRole="link"
      accessibilityLabel={t('shared.asaasBadge')}
      hitSlop={8}
    >
      <SvgUri
        uri={SELO_URI}
        width={imgWidth}
        height={imgHeight}
      />
    </Pressable>
  )
}
