// Plano CNPJ (velvet-puzzling-sedgewick)
// Gestão de operadores — só o master (ou operador com gerenciar_operadores)
// acessa esta tela. Convite por handle + matriz de permissões por operador,
// editável a qualquer momento (não é um papel fixo).

import { useEffect, useState } from 'react'
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Header } from '../../../../components/core/Header'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { useAuthStore } from '../../../../store/auth.store'
import { useCompanyStore } from '../../../../store/company.store'
import * as companyService from '../../../../services/company.service'
import { BffError } from '../../../../services/auth.service'
import { colors } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

const PERMISSION_KEYS = [
  'ver_saldo', 'ver_extrato', 'carregar', 'descarregar', 'transferir', 'receber', 'pagar', 'gerenciar_operadores',
] as const

export default function OperadoresScreen() {
  const { t }  = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const token  = useAuthStore(s => s.token)

  const operators       = useCompanyStore(s => s.operators)
  const operatorsStatus = useCompanyStore(s => s.operatorsStatus)
  const fetchOperators  = useCompanyStore(s => s.fetchOperators)
  const setPermissions  = useCompanyStore(s => s.setOperatorPermissions)
  const removeOperator  = useCompanyStore(s => s.removeOperator)

  const [handle, setHandle]         = useState('')
  const [inviting, setInviting]     = useState(false)
  const [creatingLink, setCreatingLink] = useState(false)
  const [expanded, setExpanded]     = useState<string | null>(null)
  const [removing, setRemoving]     = useState<string | null>(null)

  useEffect(() => {
    if (id) fetchOperators(id)
  }, [id])

  const handleInvite = async () => {
    if (!token || !id || !handle.trim() || inviting) return
    setInviting(true)
    try {
      await companyService.inviteOperator(token, id, handle.trim())
      setHandle('')
      await fetchOperators(id)
    } catch (e) {
      const isBff = e instanceof BffError
      Alert.alert(t('empresas.operadores.inviteErrorTitle'), isBff ? e.message : t('empresas.operadores.inviteErrorGeneric'))
    } finally {
      setInviting(false)
    }
  }

  // Convite por link — para quem nunca usou o Alber (ver
  // app/(auth)/convite-operador/[token].tsx). Diferente do convite por
  // @handle acima, que exige que a pessoa já tenha conta.
  const handleCreateInviteLink = async () => {
    if (!token || !id || creatingLink) return
    setCreatingLink(true)
    try {
      const res = await companyService.createInviteLink(token, id)
      const url = `alber://convite-operador/${res.token}`
      await Share.share({ message: url })
    } catch (e) {
      const isBff = e instanceof BffError
      Alert.alert(t('empresas.operadores.inviteErrorTitle'), isBff ? e.message : t('empresas.operadores.inviteErrorGeneric'))
    } finally {
      setCreatingLink(false)
    }
  }

  const togglePermission = (operatorUserId: string, key: string, value: boolean) => {
    if (!id) return
    setPermissions(id, operatorUserId, { [key]: value })
  }

  const handleRemove = (operatorUserId: string, name: string) => {
    if (!id) return
    Alert.alert(
      t('empresas.operadores.removeConfirmTitle'),
      t('empresas.operadores.removeConfirmBody', { name }),
      [
        { text: t('empresas.operadores.removeCancel'), style: 'cancel' },
        {
          text: t('empresas.operadores.removeConfirmCta'),
          style: 'destructive',
          onPress: async () => {
            setRemoving(operatorUserId)
            try {
              await removeOperator(id, operatorUserId)
              setExpanded(null)
            } catch (e) {
              const isBff = e instanceof BffError
              Alert.alert(t('empresas.operadores.removeErrorTitle'), isBff ? e.message : t('empresas.operadores.removeErrorGeneric'))
            } finally {
              setRemoving(null)
            }
          },
        },
      ],
    )
  }

  return (
    <View style={styles.root}>
      <Header variant="title" title={t('empresas.operadores.title')} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inviteRow}>
          <TextInput
            style={styles.inviteInput}
            value={handle}
            onChangeText={setHandle}
            placeholder={t('empresas.operadores.invitePlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCapitalize="none"
          />
          <PrimaryButton
            label={t('empresas.operadores.inviteCta')}
            onPress={handleInvite}
            state={inviting ? 'loading' : 'default'}
          />
        </View>

        <TouchableOpacity style={styles.linkInviteBtn} onPress={handleCreateInviteLink} disabled={creatingLink}>
          <Text style={styles.linkInviteBtnText}>
            {creatingLink ? t('empresas.operadores.creatingLink') : t('empresas.operadores.inviteByLinkCta')}
          </Text>
        </TouchableOpacity>

        {operatorsStatus === 'success' && operators.length === 0 && (
          <Text style={styles.empty}>{t('empresas.operadores.empty')}</Text>
        )}

        {operators.map(op => (
          <View key={op.operator_id} style={styles.card}>
            <TouchableOpacity
              style={styles.cardHeader}
              onPress={() => setExpanded(expanded === op.operator_id ? null : op.operator_id)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{op.name ?? op.handle ?? '—'}</Text>
                <Text style={styles.cardHandle}>@{op.handle} · {t(`empresas.operadores.status.${op.status}`)}</Text>
              </View>
              <Text style={styles.chevron}>{expanded === op.operator_id ? '︿' : '﹀'}</Text>
            </TouchableOpacity>

            {expanded === op.operator_id && op.user_id && (
              <View style={styles.permList}>
                {PERMISSION_KEYS.map(key => (
                  <View key={key} style={styles.permRow}>
                    <Text style={styles.permLabel}>{t(`empresas.permissoes.${key}`)}</Text>
                    <Switch
                      value={op.permissions?.[key] === true}
                      onValueChange={v => togglePermission(op.user_id!, key, v)}
                      disabled={op.status === 'banned'}
                      trackColor={{ false: 'rgba(255,255,255,0.15)', true: colors.white[100] }}
                      thumbColor={colors.black[100]}
                    />
                  </View>
                ))}

                {op.status !== 'banned' && (
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => handleRemove(op.user_id!, op.name ?? op.handle ?? '')}
                    disabled={removing === op.user_id}
                  >
                    <Text style={styles.removeBtnText}>
                      {removing === op.user_id ? t('empresas.operadores.removing') : t('empresas.operadores.removeCta')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  inviteRow: { gap: spacing.sm, marginBottom: spacing.md },
  inviteInput: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.2)',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontSize: 16,
    paddingVertical: 8,
  },
  empty: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
    marginTop: spacing.lg,
  },
  linkInviteBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: spacing.md,
  },
  linkInviteBtnText: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: typography.fontFamily.primary,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  card: {
    borderRadius: spacing.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardName: {
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  cardHandle: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily.primary,
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  permList: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.xs,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  permRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  permLabel: {
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    fontSize: 13.5,
  },
  removeBtn: {
    marginTop: spacing.xs,
    paddingVertical: 10,
    alignItems: 'center',
  },
  removeBtnText: {
    color: colors.state.error,
    fontFamily: typography.fontFamily.primary,
    fontSize: 13,
  },
})
