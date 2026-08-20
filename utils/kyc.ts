// Extraído de app/(app)/perfil/index.tsx — label + cor por status de KYC,
// usado pelo perfil pessoal e pelo perfil da empresa.

import { colors } from '../tokens/colors'

export function kycInfo(status: string, t: (k: string) => string): { label: string; color: string } {
  switch (status) {
    case 'approved':  return { label: t('perfil.kycApproved'),  color: colors.state.success }
    case 'submitted': return { label: t('perfil.kycSubmitted'), color: colors.warning[500] }
    case 'rejected':  return { label: t('perfil.kycRejected'),  color: colors.state.error }
    default:          return { label: t('perfil.kycPending'),   color: colors.warning[500] }
  }
}
