// Central de notificações (sininho) — transações, convites etc.
// Gravadas no backend por push-send (ver supabase/functions/push-send).

import { create } from 'zustand'
import * as notificationsService from '../services/notifications.service'
import { BffError } from '../services/auth.service'
import { setRealtimeAuth, subscribeToNotifications } from '../services/notifications-realtime.service'

export interface NotificationItem {
  id:        string
  type:      'transaction' | 'invite' | 'other'
  title:     string
  body:      string
  route:     string | null
  read:      boolean
  createdAt: string
}

interface NotificationsState {
  items:       NotificationItem[]
  unreadCount: number
  loading:     boolean
  error:       string | null

  fetchNotifications: (token: string) => Promise<void>
  markRead:           (ids: string[], token: string) => Promise<void>
  markAllRead:        (token: string) => Promise<void>
  subscribeRealtime:  (userId: string, token: string) => () => void
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items:       [],
  unreadCount: 0,
  loading:     false,
  error:       null,

  fetchNotifications: async (token) => {
    set({ loading: true, error: null })
    try {
      const items = await notificationsService.getNotifications(token)
      set({ items, unreadCount: items.filter(i => !i.read).length, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof BffError ? e.message : 'Erro ao carregar notificações' })
    }
  },

  markRead: async (ids, token) => {
    if (ids.length === 0) return
    set(s => {
      const idSet = new Set(ids)
      const items = s.items.map(i => idSet.has(i.id) ? { ...i, read: true } : i)
      return { items, unreadCount: items.filter(i => !i.read).length }
    })
    try {
      await notificationsService.markNotificationsRead({ ids }, token)
    } catch {
      // best-effort — próximo fetchNotifications reconcilia o estado
    }
  },

  markAllRead: async (token) => {
    set(s => ({ items: s.items.map(i => ({ ...i, read: true })), unreadCount: 0 }))
    try {
      await notificationsService.markNotificationsRead({ all: true }, token)
    } catch {
      // best-effort
    }
  },

  subscribeRealtime: (userId, token) => {
    setRealtimeAuth(token)
    return subscribeToNotifications(userId, (row) => {
      const item = notificationsService.mapNotificationRow(row)
      set(s => ({
        items:       [item, ...s.items],
        unreadCount: s.unreadCount + (item.read ? 0 : 1),
      }))
    })
  },
}))
