// Spec: /specs/06_modules/alber_lounge.md
// Zustand store — conectado ao backend real via lounge.service.ts

import { create } from 'zustand'
import * as loungeService from '../services/lounge.service'
import { BffError } from '../services/auth.service'
import type { LoungeEvent, EventBatch } from '../components/lounge/EventCard'
import type { LoungeRole } from '../components/lounge/LoungeCard'

export type { LoungeRole }

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface LoungeMember {
  id:       string
  name:     string
  handle:   string
  initials: string
  role:     LoungeRole
  joinedAt: string
}

export interface LoungeRequest {
  id:          string
  userId:      string
  name:        string
  handle:      string
  initials:    string
  requestedAt: string
}

export interface LoungeMessage {
  id:             string
  authorId:       string
  authorName:     string
  authorHandle:   string
  authorInitials: string
  role:           'owner' | 'manager'
  content:        string
  createdAt:      string
}

export interface LoungeTicket {
  id:          string
  eventId:     string
  eventName:   string
  loungeId:    string
  loungeName:  string
  batchId:     string
  batchName:   string
  priceBrl:    number
  priceAlbers: number
  purchasedAt: string
  eventDate:   string
}

export interface Lounge {
  id:              string
  name:            string
  description:     string
  accent:          string
  bgDark:          string
  imageUri:        string | null
  visibility:      'public' | 'private'
  memberCount:     number
  role:            LoungeRole
  ownerId:         string
  members:         LoungeMember[]
  pendingRequests: LoungeRequest[]
  events:          LoungeEvent[]
  messages:        LoungeMessage[]
  inviteToken:     string | null
  createdAt:       string
}

export interface CreateLoungeInput {
  name:        string
  description: string
  visibility:  'public' | 'private'
  accent:      string
  imageUri:    string | null
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface LoungeState {
  myLounges:     Lounge[]
  exploring:     Lounge[]
  currentLounge: Lounge | null
  myTickets:     LoungeTicket[]
  loading:       boolean
  error:         string | null

  // Queries
  getLoungeById:          (id: string) => Lounge | undefined
  getEventById:           (id: string) => { event: LoungeEvent; lounge: Lounge } | undefined
  hasActiveLoungeAsOwner: () => boolean

  // Fetch
  fetchMyLounges:  (token: string) => Promise<void>
  fetchLounge:     (id: string, myUserId: string, token: string) => Promise<void>
  fetchExploring:  (query: string, token: string) => Promise<void>
  setCurrentLounge:(id: string) => void

  // Write
  createLounge:   (input: CreateLoungeInput, token: string) => Promise<loungeService.CreateLoungeResponse>
  joinLounge:     (params: { space_id?: string; invite_token?: string }, token: string) => Promise<loungeService.JoinLoungeResponse>
  approveRequest: (memberId: string, approved: boolean, token: string) => Promise<void>
  createEvent:    (data: loungeService.CreateEventInput, token: string) => Promise<void>
  buyTicket:      (eventId: string, pinHash: string | undefined, token: string) => Promise<loungeService.BuyTicketResponse>

  // Local-only (sem EF definida no MVP)
  promoteMember:  (loungeId: string, memberId: string) => void
  removeMember:   (loungeId: string, memberId: string) => void
  sendMessage:    (loungeId: string, content: string, authorName: string, authorHandle: string, authorInitials: string) => void
  updateVisual:   (loungeId: string, accent: string, imageUri?: string | null) => void
  cancelEvent:    (eventId: string) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useLoungeStore = create<LoungeState>((set, get) => ({
  myLounges:     [],
  exploring:     [],
  currentLounge: null,
  myTickets:     [],
  loading:       false,
  error:         null,

  // ── Queries ──────────────────────────────────────────────────────────────────

  getLoungeById: (id) => {
    const { myLounges, exploring } = get()
    return myLounges.find(l => l.id === id) ?? exploring.find(l => l.id === id)
  },

  getEventById: (id) => {
    const { myLounges, exploring } = get()
    for (const lounge of [...myLounges, ...exploring]) {
      const event = lounge.events.find(e => e.id === id)
      if (event) return { event, lounge }
    }
    return undefined
  },

  hasActiveLoungeAsOwner: () =>
    get().myLounges.some(l => l.role === 'owner'),

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  fetchMyLounges: async (token) => {
    set({ loading: true, error: null })
    try {
      const lounges = await loungeService.getMyLounges(token)
      set({ myLounges: lounges, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof BffError ? e.message : 'Erro ao carregar Lounges' })
    }
  },

  fetchLounge: async (id, myUserId, token) => {
    set({ loading: true, error: null })
    try {
      const lounge = await loungeService.getLounge(id, myUserId, token)
      if (!lounge) {
        set({ loading: false })
        return
      }
      set(s => ({
        loading: false,
        myLounges: s.myLounges.some(l => l.id === id)
          ? s.myLounges.map(l => l.id === id ? lounge : l)
          : [...s.myLounges, lounge],
      }))
    } catch (e) {
      set({ loading: false, error: e instanceof BffError ? e.message : 'Erro ao carregar Lounge' })
    }
  },

  fetchExploring: async (query, token) => {
    set({ loading: true, error: null })
    try {
      const lounges = await loungeService.getExploring(query, token)
      set({ exploring: lounges, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof BffError ? e.message : 'Erro ao buscar Lounges' })
    }
  },

  setCurrentLounge: (id) => {
    const lounge = get().getLoungeById(id) ?? null
    set({ currentLounge: lounge })
  },

  // ── Write ─────────────────────────────────────────────────────────────────────

  createLounge: async (input, token) => {
    set({ loading: true, error: null })
    try {
      const res = await loungeService.createLounge({
        name:        input.name,
        type:        input.visibility === 'public' ? 'open' : 'closed',
        description: input.description,
        skin:        { accent: input.accent, bgDark: '#0a0a0a' },
      }, token)
      set({ loading: false })
      return res
    } catch (e) {
      set({ loading: false, error: e instanceof BffError ? e.message : 'Erro ao criar Lounge' })
      throw e
    }
  },

  joinLounge: async (params, token) => {
    set({ error: null })
    try {
      const res = await loungeService.joinLounge(params, token)
      return res
    } catch (e) {
      set({ error: e instanceof BffError ? e.message : 'Erro ao entrar no Lounge' })
      throw e
    }
  },

  approveRequest: async (memberId, approved, token) => {
    set({ error: null })
    try {
      await loungeService.approveMember(memberId, approved, token)
      // Atualizar lista local
      set(s => ({
        myLounges: s.myLounges.map(l => ({
          ...l,
          pendingRequests: l.pendingRequests.filter(r => r.id !== memberId),
          ...(approved ? {
            members: [
              ...l.members,
              ...(l.pendingRequests.filter(r => r.id === memberId).map(r => ({
                id: r.userId, name: r.name, handle: r.handle,
                initials: r.initials, role: 'member' as LoungeRole,
                joinedAt: new Date().toISOString(),
              }))),
            ],
            memberCount: l.memberCount + (l.pendingRequests.some(r => r.id === memberId) ? 1 : 0),
          } : {}),
        })),
      }))
    } catch (e) {
      set({ error: e instanceof BffError ? e.message : 'Erro ao processar solicitação' })
      throw e
    }
  },

  createEvent: async (data, token) => {
    set({ error: null })
    try {
      await loungeService.createEvent(data, token)
      // O detalhe do lounge será recarregado pela tela via fetchLounge
    } catch (e) {
      set({ error: e instanceof BffError ? e.message : 'Erro ao criar evento' })
      throw e
    }
  },

  buyTicket: async (eventId, pinHash, token) => {
    set({ error: null })
    try {
      const res = await loungeService.buyTicket(eventId, pinHash, token)
      // Atualizar batch localmente (optimistic update)
      set(s => ({
        myLounges: s.myLounges.map(l => ({
          ...l,
          events: l.events.map(e => {
            if (e.id !== eventId) return e
            const updatedBatches = e.batches.map(b => {
              if (b.id !== res.batch_id) return b
              const newSold = b.sold + 1
              return { ...b, sold: newSold, status: newSold >= b.capacity ? ('sold_out' as const) : b.status }
            })
            return { ...e, confirmed: e.confirmed + 1, batches: updatedBatches }
          }),
        })),
      }))
      // Registrar ticket localmente
      const found = get().getEventById(eventId)
      if (found) {
        const { event, lounge } = found
        const batch = event.batches.find(b => b.id === res.batch_id)
        const ticket: LoungeTicket = {
          id:          res.ticket_id,
          eventId:     res.event_id,
          eventName:   event.name,
          loungeId:    lounge.id,
          loungeName:  lounge.name,
          batchId:     res.batch_id,
          batchName:   batch?.name ?? '1º Lote',
          priceBrl:    res.price_brl,
          priceAlbers: res.price_albers,
          purchasedAt: res.purchased_at,
          eventDate:   event.date,
        }
        set(s => ({ myTickets: [...s.myTickets, ticket] }))
      }
      return res
    } catch (e) {
      set({ error: e instanceof BffError ? e.message : 'Erro ao comprar ingresso' })
      throw e
    }
  },

  // ── Local-only ────────────────────────────────────────────────────────────────

  promoteMember: (loungeId, memberId) => {
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId
          ? { ...l, members: l.members.map(m => m.id === memberId ? { ...m, role: 'manager' as LoungeRole } : m) }
          : l
      ),
    }))
  },

  removeMember: (loungeId, memberId) => {
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId
          ? { ...l, members: l.members.filter(m => m.id !== memberId), memberCount: l.memberCount - 1 }
          : l
      ),
    }))
  },

  sendMessage: (loungeId, content, authorName, authorHandle, authorInitials) => {
    const msg: LoungeMessage = {
      id:             `msg-${Date.now()}`,
      authorId:       'self',
      authorName,
      authorHandle,
      authorInitials,
      role:           'owner',
      content,
      createdAt:      new Date().toISOString(),
    }
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId ? { ...l, messages: [msg, ...l.messages] } : l
      ),
    }))
  },

  updateVisual: (loungeId, accent, imageUri) => {
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId
          ? { ...l, accent, ...(imageUri !== undefined ? { imageUri } : {}) }
          : l
      ),
    }))
  },

  cancelEvent: (eventId) => {
    const update = (events: LoungeEvent[]) =>
      events.map(e => e.id === eventId ? { ...e, status: 'cancelled' as const } : e)
    set(s => ({
      myLounges: s.myLounges.map(l => ({ ...l, events: update(l.events) })),
      exploring: s.exploring.map(l => ({ ...l, events: update(l.events) })),
    }))
  },
}))
