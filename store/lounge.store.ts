// Spec: /specs/06_modules/alber_lounge.md
// Zustand store para Sprint 5 — Alber Lounge
// Mock ativo — conectar ao Supabase no Sprint 6

import { create } from 'zustand'
import type { LoungeEvent, EventBatch } from '../components/lounge/EventCard'
import type { LoungeRole } from '../components/lounge/LoungeCard'

export type { LoungeRole }

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface LoungeMember {
  id:        string
  name:      string
  handle:    string
  initials:  string
  role:      LoungeRole
  joinedAt:  string
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
  id:           string
  eventId:      string
  eventName:    string
  loungeId:     string
  loungeName:   string
  batchId:      string
  batchName:    string
  priceBrl:     number
  priceAlbers:  number
  purchasedAt:  string
  eventDate:    string
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

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_BATCH_SURF: EventBatch = {
  id:          'b-surf-1',
  name:        '1º Lote',
  batchNumber: 1,
  batchType:   'quantity',
  priceBrl:    80,
  priceAlbers: 80,
  capacity:    40,
  sold:        34,
  validUntil:  null,
  status:      'active',
}

const MOCK_BATCH_GOURMET: EventBatch = {
  id:          'b-gourmet-1',
  name:        '1º Lote',
  batchNumber: 1,
  batchType:   'date',
  priceBrl:    120,
  priceAlbers: 120,
  capacity:    20,
  sold:        20,
  validUntil:  '30/06/2026',
  status:      'sold_out',
}

const MOCK_BATCH_GOURMET_2: EventBatch = {
  id:          'b-gourmet-2',
  name:        '2º Lote',
  batchNumber: 2,
  batchType:   'date',
  priceBrl:    150,
  priceAlbers: 150,
  capacity:    20,
  sold:        3,
  validUntil:  '15/07/2026',
  status:      'active',
}

const MOCK_EVENTS_SURF: LoungeEvent[] = [
  {
    id:             'ev-surf-1',
    loungeId:       'lounge-surf',
    name:           'Sessão de Longboard — Praia Grande',
    description:    'Tarde de surf seguida de roda de conversa na areia.',
    imageUri:       null,
    date:           'Sáb, 14 Jun · 07h00',
    visibility:     'members_only',
    isPaid:         true,
    isRecurring:    true,
    recurrenceFreq: 'weekly',
    batches:        [MOCK_BATCH_SURF],
    totalCapacity:  40,
    confirmed:      34,
    status:         'active',
    createdAt:      '2026-05-10T10:00:00Z',
  },
  {
    id:             'ev-surf-2',
    loungeId:       'lounge-surf',
    name:           'Encontro de Verão — Abertura Temporada',
    description:    'Confraternização de abertura da temporada de verão.',
    imageUri:       null,
    date:           'Dom, 22 Jun · 15h00',
    visibility:     'public',
    isPaid:         false,
    isRecurring:    false,
    recurrenceFreq: null,
    batches:        [],
    totalCapacity:  80,
    confirmed:      31,
    status:         'active',
    createdAt:      '2026-05-15T12:00:00Z',
  },
]

const MOCK_EVENTS_GOURMET: LoungeEvent[] = [
  {
    id:             'ev-gourmet-1',
    loungeId:       'lounge-gourmet',
    name:           'Jantar de Harmonização — Julho',
    description:    'Menu degustação com vinhos selecionados.',
    imageUri:       null,
    date:           'Sex, 11 Jul · 20h00',
    visibility:     'members_only',
    isPaid:         true,
    isRecurring:    false,
    recurrenceFreq: null,
    batches:        [MOCK_BATCH_GOURMET, MOCK_BATCH_GOURMET_2],
    totalCapacity:  40,
    confirmed:      23,
    status:         'active',
    createdAt:      '2026-05-20T09:00:00Z',
  },
]

const MOCK_MESSAGES_SURF: LoungeMessage[] = [
  {
    id:             'msg-surf-1',
    authorId:       'user-dono-surf',
    authorName:     'Rodrigo Maia',
    authorHandle:   '@rodrigomaia',
    authorInitials: 'RM',
    role:           'owner',
    content:        'Galera, sessão confirmada pra esse sábado! Encontro às 6h45 no estacionamento da Praia Grande. Vai ser épico 🤙',
    createdAt:      '2026-05-25T18:30:00Z',
  },
  {
    id:             'msg-surf-2',
    authorId:       'user-gestor-surf',
    authorName:     'Ana Moreira',
    authorHandle:   '@anamoreira',
    authorInitials: 'AM',
    role:           'manager',
    content:        'Lembrando: ingressos do 1º lote têm 6 vagas restantes. Corre lá!',
    createdAt:      '2026-05-24T14:10:00Z',
  },
]

const MOCK_MESSAGES_GOURMET: LoungeMessage[] = [
  {
    id:             'msg-gourmet-1',
    authorId:       'user-self',
    authorName:     'Você',
    authorHandle:   '@voce',
    authorInitials: 'VO',
    role:           'owner',
    content:        'Jantar de Julho confirmado! Menu especial com harmonização de vinhos portugueses. 2º lote aberto agora.',
    createdAt:      '2026-05-22T11:00:00Z',
  },
]

const MOCK_MEMBERS_SURF: LoungeMember[] = [
  { id: 'user-dono-surf',   name: 'Rodrigo Maia',   handle: '@rodrigomaia',  initials: 'RM', role: 'owner',   joinedAt: '2026-01-10T10:00:00Z' },
  { id: 'user-gestor-surf', name: 'Ana Moreira',    handle: '@anamoreira',   initials: 'AM', role: 'manager', joinedAt: '2026-01-12T08:00:00Z' },
  { id: 'user-self',        name: 'Você',           handle: '@voce',         initials: 'VO', role: 'member',  joinedAt: '2026-02-01T09:00:00Z' },
  { id: 'user-m1',          name: 'Carlos Lima',    handle: '@carloslima',   initials: 'CL', role: 'member',  joinedAt: '2026-02-15T11:00:00Z' },
  { id: 'user-m2',          name: 'Julia Prado',    handle: '@juliaprado',   initials: 'JP', role: 'member',  joinedAt: '2026-03-05T14:00:00Z' },
]

const MOCK_MEMBERS_GOURMET: LoungeMember[] = [
  { id: 'user-self',  name: 'Você',          handle: '@voce',         initials: 'VO', role: 'owner',  joinedAt: '2026-03-01T10:00:00Z' },
  { id: 'user-gm1',  name: 'Beatriz Costa', handle: '@beatrizcosta', initials: 'BC', role: 'member', joinedAt: '2026-03-10T09:00:00Z' },
  { id: 'user-gm2',  name: 'Felipe Nunes',  handle: '@felipenunes',  initials: 'FN', role: 'member', joinedAt: '2026-03-15T13:00:00Z' },
  { id: 'user-gm3',  name: 'Carla Duarte',  handle: '@carladuarte',  initials: 'CD', role: 'member', joinedAt: '2026-04-01T10:00:00Z' },
]

const MOCK_REQUESTS_SURF: LoungeRequest[] = [
  { id: 'req-1', userId: 'user-r1', name: 'Paulo Mendes',  handle: '@paulomendes',  initials: 'PM', requestedAt: '2026-05-24T09:30:00Z' },
  { id: 'req-2', userId: 'user-r2', name: 'Tânia Ribeiro', handle: '@taniaribeiro', initials: 'TR', requestedAt: '2026-05-25T16:00:00Z' },
]

const INITIAL_LOUNGES: Lounge[] = [
  {
    id:              'lounge-surf',
    name:            'Surf Club SP',
    description:     'Comunidade de surfistas de São Paulo. Sessões semanais, eventos na praia e muito stoke.',
    accent:          '#5BCEC9',
    bgDark:          '#050a0c',
    imageUri:        null,
    visibility:      'public',
    memberCount:     47,
    role:            'member',
    ownerId:         'user-dono-surf',
    members:         MOCK_MEMBERS_SURF,
    pendingRequests: MOCK_REQUESTS_SURF,
    events:          MOCK_EVENTS_SURF,
    messages:        MOCK_MESSAGES_SURF,
    inviteToken:     null,
    createdAt:       '2026-01-10T10:00:00Z',
  },
  {
    id:              'lounge-gourmet',
    name:            'Gourmet Club',
    description:     'Experiências gastronômicas exclusivas. Jantares, harmonizações e passeios culinários.',
    accent:          '#E07D7D',
    bgDark:          '#080606',
    imageUri:        null,
    visibility:      'private',
    memberCount:     24,
    role:            'owner',
    ownerId:         'user-self',
    members:         MOCK_MEMBERS_GOURMET,
    pendingRequests: [],
    events:          MOCK_EVENTS_GOURMET,
    messages:        MOCK_MESSAGES_GOURMET,
    inviteToken:     'inv-gourmet-2026',
    createdAt:       '2026-03-01T10:00:00Z',
  },
]

const MOCK_EXPLORING: Lounge[] = [
  {
    id:              'lounge-nomads',
    name:            'Nomads Club',
    description:     'Trabalho remoto, viagens e comunidade para nômades digitais.',
    accent:          '#C9B06A',
    bgDark:          '#080808',
    imageUri:        null,
    visibility:      'public',
    memberCount:     112,
    role:            null,
    ownerId:         'user-nomads-dono',
    members:         [],
    pendingRequests: [],
    events:          [],
    messages:        [],
    inviteToken:     null,
    createdAt:       '2025-11-01T10:00:00Z',
  },
  {
    id:              'lounge-tech',
    name:            'Tech Builders',
    description:     'Builders, founders e engenheiros. Demo days, hacking sessions e muito código.',
    accent:          '#7DA3E0',
    bgDark:          '#060608',
    imageUri:        null,
    visibility:      'public',
    memberCount:     88,
    role:            null,
    ownerId:         'user-tech-dono',
    members:         [],
    pendingRequests: [],
    events:          [],
    messages:        [],
    inviteToken:     null,
    createdAt:       '2025-12-15T10:00:00Z',
  },
  ...INITIAL_LOUNGES.filter(l => l.visibility === 'public'),
]

// ─── Store interface ──────────────────────────────────────────────────────────

interface LoungeState {
  myLounges:     Lounge[]
  exploring:     Lounge[]
  currentLounge: Lounge | null
  myTickets:     LoungeTicket[]
  loading:       boolean
  error:         string | null

  // Queries
  getLoungeById:  (id: string) => Lounge | undefined
  getEventById:   (id: string) => { event: LoungeEvent; lounge: Lounge } | undefined
  hasActiveLoungeAsOwner: () => boolean

  // Actions
  fetchMyLounges:  () => void
  fetchExploring:  (query?: string) => void
  setCurrentLounge:(id: string) => void
  createLounge:    (input: CreateLoungeInput) => Lounge
  joinLounge:      (loungeId: string) => void
  approveRequest:  (loungeId: string, requestId: string) => void
  rejectRequest:   (loungeId: string, requestId: string) => void
  promoteMember:   (loungeId: string, memberId: string) => void
  removeMember:    (loungeId: string, memberId: string) => void
  sendMessage:     (loungeId: string, content: string) => void
  updateVisual:    (loungeId: string, accent: string) => void
  generateInvite:  (loungeId: string) => string
  buyTicket:       (eventId: string, batchId: string) => void
  createEvent:     (loungeId: string, event: LoungeEvent) => void
  cancelEvent:     (eventId: string) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useLoungeStore = create<LoungeState>((set, get) => ({
  myLounges:     INITIAL_LOUNGES,
  exploring:     MOCK_EXPLORING,
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

  // ── Actions ──────────────────────────────────────────────────────────────────

  fetchMyLounges: () => {
    set({ loading: true, error: null })
    // Mock: already seeded — simulate async
    setTimeout(() => set({ loading: false }), 300)
  },

  fetchExploring: (query = '') => {
    set({ loading: true, error: null })
    setTimeout(() => {
      const q = query.toLowerCase()
      const filtered = q
        ? MOCK_EXPLORING.filter(l => l.name.toLowerCase().includes(q))
        : MOCK_EXPLORING
      set({ exploring: filtered, loading: false })
    }, 300)
  },

  setCurrentLounge: (id) => {
    const lounge = get().getLoungeById(id) ?? null
    set({ currentLounge: lounge })
  },

  createLounge: (input) => {
    const newLounge: Lounge = {
      id:              `lounge-${Date.now()}`,
      name:            input.name,
      description:     input.description,
      accent:          input.accent,
      bgDark:          '#0a0a0a',
      imageUri:        input.imageUri,
      visibility:      input.visibility,
      memberCount:     1,
      role:            'owner',
      ownerId:         'user-self',
      members:         [{ id: 'user-self', name: 'Você', handle: '@voce', initials: 'VO', role: 'owner', joinedAt: new Date().toISOString() }],
      pendingRequests: [],
      events:          [],
      messages:        [],
      inviteToken:     input.visibility === 'private' ? `inv-${Date.now()}` : null,
      createdAt:       new Date().toISOString(),
    }
    set(s => ({ myLounges: [...s.myLounges, newLounge] }))
    return newLounge
  },

  joinLounge: (loungeId) => {
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId ? l : l
      ),
      exploring: s.exploring.map(l => {
        if (l.id !== loungeId) return l
        // Public: request sent (pending), private: immediate via invite
        return { ...l, role: 'member' as LoungeRole, memberCount: l.memberCount + 1 }
      }),
    }))
  },

  approveRequest: (loungeId, requestId) => {
    set(s => ({
      myLounges: s.myLounges.map(l => {
        if (l.id !== loungeId) return l
        const req = l.pendingRequests.find(r => r.id === requestId)
        if (!req) return l
        const newMember: LoungeMember = {
          id: req.userId, name: req.name, handle: req.handle,
          initials: req.initials, role: 'member', joinedAt: new Date().toISOString(),
        }
        return {
          ...l,
          pendingRequests: l.pendingRequests.filter(r => r.id !== requestId),
          members: [...l.members, newMember],
          memberCount: l.memberCount + 1,
        }
      }),
    }))
  },

  rejectRequest: (loungeId, requestId) => {
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId
          ? { ...l, pendingRequests: l.pendingRequests.filter(r => r.id !== requestId) }
          : l
      ),
    }))
  },

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

  sendMessage: (loungeId, content) => {
    const msg: LoungeMessage = {
      id:             `msg-${Date.now()}`,
      authorId:       'user-self',
      authorName:     'Você',
      authorHandle:   '@voce',
      authorInitials: 'VO',
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

  updateVisual: (loungeId, accent) => {
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId ? { ...l, accent } : l
      ),
    }))
  },

  generateInvite: (loungeId) => {
    const token = `inv-${loungeId}-${Date.now()}`
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId ? { ...l, inviteToken: token } : l
      ),
    }))
    return token
  },

  buyTicket: (eventId, batchId) => {
    const found = get().getEventById(eventId)
    if (!found) return
    const { event, lounge } = found
    const batch = event.batches.find(b => b.id === batchId)
    if (!batch) return

    const ticket: LoungeTicket = {
      id:          `ticket-${Date.now()}`,
      eventId:     event.id,
      eventName:   event.name,
      loungeId:    lounge.id,
      loungeName:  lounge.name,
      batchId:     batch.id,
      batchName:   batch.name,
      priceBrl:    batch.priceBrl,
      priceAlbers: batch.priceAlbers,
      purchasedAt: new Date().toISOString(),
      eventDate:   event.date,
    }

    // Increment sold count on the batch
    const updateEvents = (events: LoungeEvent[]) =>
      events.map(e =>
        e.id !== eventId ? e : {
          ...e,
          confirmed: e.confirmed + 1,
          batches: e.batches.map(b =>
            b.id !== batchId ? b : {
              ...b,
              sold: b.sold + 1,
              status: b.sold + 1 >= b.capacity ? ('sold_out' as const) : b.status,
            }
          ),
        }
      )

    set(s => ({
      myTickets: [...s.myTickets, ticket],
      myLounges: s.myLounges.map(l =>
        l.id === lounge.id ? { ...l, events: updateEvents(l.events) } : l
      ),
      exploring: s.exploring.map(l =>
        l.id === lounge.id ? { ...l, events: updateEvents(l.events) } : l
      ),
    }))
  },

  createEvent: (loungeId, event) => {
    set(s => ({
      myLounges: s.myLounges.map(l =>
        l.id === loungeId ? { ...l, events: [...l.events, event] } : l
      ),
    }))
  },

  cancelEvent: (eventId) => {
    const updateEvents = (events: LoungeEvent[]) =>
      events.map(e => e.id === eventId ? { ...e, status: 'cancelled' as const } : e)

    set(s => ({
      myLounges: s.myLounges.map(l => ({ ...l, events: updateEvents(l.events) })),
      exploring: s.exploring.map(l => ({ ...l, events: updateEvents(l.events) })),
    }))
  },
}))
