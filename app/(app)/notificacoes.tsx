// Spec: sino de notificações (Home) — transações, convites etc.
// Lista das notificações registradas pelo backend (ver push-send).

import { useEffect } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useNotificationsStore } from '../../store/notifications.store'
import type { NotificationItem } from '../../store/notifications.store'
import { useAuthStore } from '../../store/auth.store'
import { Header } from '../../components/core/Header'
import { colors, spaceSkins } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string, t: ReturnType<typeof useTranslation>['t']): string {
  const ms  = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1)  return t('notificacoes.timeJustNow')
  if (min < 60) return t('notificacoes.timeMinAgo', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24)   return t('notificacoes.timeHourAgo', { n: h })
  return t('notificacoes.timeDayAgo', { n: Math.floor(h / 24) })
}

function iconFor(type: NotificationItem['type']): string {
  if (type === 'transaction') return '↕'
  if (type === 'invite')      return '✉'
  return '•'
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificacoesScreen() {
  const { t } = useTranslation()

  const token       = useAuthStore(s => s.token)
  const items       = useNotificationsStore(s => s.items)
  const unreadCount = useNotificationsStore(s => s.unreadCount)
  const loading     = useNotificationsStore(s => s.loading)
  const error       = useNotificationsStore(s => s.error)
  const fetchNotifications = useNotificationsStore(s => s.fetchNotifications)
  const markRead           = useNotificationsStore(s => s.markRead)
  const markAllRead        = useNotificationsStore(s => s.markAllRead)

  useEffect(() => {
    if (token) fetchNotifications(token)
  }, [token])

  function handlePress(item: NotificationItem) {
    if (!token) return
    if (!item.read) markRead([item.id], token)
    if (item.route) router.push(item.route as never)
  }

  function handleMarkAllRead() {
    if (!token || unreadCount === 0) return
    markAllRead(token)
  }

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={t('notificacoes.title')}
        onBack={() => router.back()}
        right={
          <TouchableOpacity
            onPress={handleMarkAllRead}
            disabled={unreadCount === 0}
            hitSlop={8}
          >
            <Text style={[styles.markAllText, unreadCount === 0 && styles.markAllTextDisabled]}>
              {t('notificacoes.markAllRead')}
            </Text>
          </TouchableOpacity>
        }
      />

      {loading && items.length === 0 ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="rgba(255,255,255,0.5)" />
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>{t('notificacoes.empty')}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {items.map((item, i) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => handlePress(item)}
              style={[styles.row, i > 0 && styles.rowBorder]}
              activeOpacity={0.7}
            >
              <View style={[styles.iconBadge, !item.read && { backgroundColor: `${spaceSkins.surf.accent}22` }]}>
                <Text style={styles.iconText}>{iconFor(item.type)}</Text>
              </View>
              <View style={styles.rowInfo}>
                <Text style={[styles.rowTitle, !item.read && styles.rowTitleUnread]}>{item.title}</Text>
                <Text style={styles.rowBody} numberOfLines={2}>{item.body}</Text>
                <Text style={styles.rowTime}>{relativeTime(item.createdAt, t)}</Text>
              </View>
              {!item.read && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },

  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  errorText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
  },

  markAllText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: spaceSkins.surf.accent,
  },
  markAllTextDisabled: {
    color: 'rgba(255,255,255,0.25)',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
  },
  rowBorder: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconText: {
    fontSize: 14,
    color: colors.white[100],
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.8)',
  },
  rowTitleUnread: {
    fontWeight: '600',
    color: colors.white[100],
  },
  rowBody: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
    lineHeight: 17,
  },
  rowTime: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: spaceSkins.surf.accent,
    marginTop: 6,
    flexShrink: 0,
  },
})
