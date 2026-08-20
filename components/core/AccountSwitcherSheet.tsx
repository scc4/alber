// Plano CNPJ (velvet-puzzling-sedgewick)
// Bottom sheet de troca de conta — Pessoal + cada empresa onde o usuário é
// master ou operador ativo. Trocar não faz nenhuma chamada de rede: só
// atualiza o contexto ativo (ver store/active-context.store.ts).

import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'
import type { ActiveContext } from '../../store/active-context.store'
import type { CompanySummary } from '../../services/company.service'

interface AccountSwitcherSheetProps {
  visible: boolean
  onClose: () => void
  hasPersonalWallet: boolean
  companies: CompanySummary[]
  current: ActiveContext
  onSelect: (context: ActiveContext) => void
}

export function AccountSwitcherSheet({
  visible,
  onClose,
  hasPersonalWallet,
  companies,
  current,
  onSelect,
}: AccountSwitcherSheetProps) {
  const { t } = useTranslation()

  const isActive = (ctx: ActiveContext) =>
    ctx.type === 'personal'
      ? current.type === 'personal'
      : current.type === 'company' && current.companyId === ctx.companyId

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.dismiss} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('accountSwitcher.title')}</Text>

          {hasPersonalWallet && (
            <Row
              label={t('accountSwitcher.personal')}
              active={isActive({ type: 'personal' })}
              onPress={() => onSelect({ type: 'personal' })}
            />
          )}

          {companies.map(c => (
            <Row
              key={c.id}
              label={c.trading_name || c.company_name}
              sublabel={c.role === 'master' ? t('empresas.roleMaster') : t('empresas.roleOperator')}
              active={isActive({ type: 'company', companyId: c.id, companyName: c.company_name })}
              onPress={() => onSelect({ type: 'company', companyId: c.id, companyName: c.trading_name || c.company_name })}
            />
          ))}
        </View>
      </View>
    </Modal>
  )
}

function Row({ label, sublabel, active, onPress }: { label: string; sublabel?: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {active && <View style={styles.activeDot} />}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.black[90],
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
  },
  rowSublabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
    fontFamily: typography.fontFamily.primary,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.white[100],
  },
})
