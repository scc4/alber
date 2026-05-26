// Spec: /specs/06_modules/split.md
// Zustand store para Sprint 4 — Split fixo, variável, prestar conta, foto por item
// Mock ativo — conectar ao Supabase no Sprint 4 (Edge Functions)

import { create } from 'zustand'

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type SplitType         = 'fixed' | 'variable'
export type SplitStatus       = 'active' | 'closed' | 'expired'
export type LinkValidity      = '1h' | '24h' | '7d' | 'custom'
export type ParticipantStatus = 'accepted' | 'pending'

export interface SplitParticipant {
  id:            string
  name:          string
  handle:        string
  initials:      string
  status:        ParticipantStatus
  /** Valor bloqueado no saldo — split variável; 0 para fixo */
  blockedAmount: number
  joinedAt:      string | null
}

export interface SplitItem {
  id:               string
  description:      string
  totalValue:       number
  /** totalValue ÷ participantCount no momento do lançamento */
  perPersonValue:   number
  /** Número de participantes ativos quando o item foi lançado */
  participantCount: number
  /** URI da foto tirada pela câmera — opcional, spec SP-13 */
  photoUri:         string | null
  createdAt:        string
}

export interface Split {
  id:             string
  name:           string
  type:           SplitType
  status:         SplitStatus
  ownerId:        string
  ownerHandle:    string
  /** Fixo: valor total da conta | Variável: valor alvo (teto) */
  totalValue:     number
  /** Número máximo de participantes (incluindo dono) definido na criação */
  participantCount: number
  participants:   SplitParticipant[]
  /** Itens lançados pelo dono — split variável (spec 11.1) */
  items:          SplitItem[]
  /** Soma de todos os itens lançados — spec 11.2 */
  totalLaunched:  number
  inviteToken:    string
  inviteDeepLink: string
  expiresAt:      string
  createdAt:      string
  closedAt:       string | null
}

/** Rascunho em memória durante o fluxo de criação */
export interface SplitDraft {
  name:           string
  type:           SplitType | null
  totalValue:     number
  participantCount: number
  linkValidity:   LinkValidity
  /** ISO string — usado quando linkValidity === 'custom' */
  customExpiry:   string | null
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function isoNow(): string {
  return new Date().toISOString()
}

function expiryFromValidity(validity: LinkValidity, custom: string | null): string {
  if (validity === 'custom' && custom) return custom
  const lookup: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 }
  const ms = lookup[validity] ?? 3_600_000
  return new Date(Date.now() + ms).toISOString()
}

function perPersonValue(totalValue: number, participantCount: number): number {
  if (participantCount <= 0) return 0
  return Math.ceil((totalValue / participantCount) * 100) / 100
}

/** Aceitos no split — usado para dividir itens lançados */
function acceptedCount(split: Split): number {
  return split.participants.filter(p => p.status === 'accepted').length
}

// ─── Mock inicial ─────────────────────────────────────────────────────────────

const MOCK_OWNER: Pick<Split, 'ownerId' | 'ownerHandle'> = {
  ownerId:     'usr_mock_001',
  ownerHandle: '@mayte',
}

const MOCK_SPLITS: Split[] = [
  {
    id:             'spl_001',
    name:           'Churrasco na laje',
    type:           'fixed',
    status:         'active',
    ...MOCK_OWNER,
    totalValue:     300,
    participantCount: 6,
    participants: [
      { id: 'usr_mock_001', name: 'Mayte',      handle: '@mayte',     initials: 'MA', status: 'accepted', blockedAmount: 0,  joinedAt: isoNow() },
      { id: 'usr_002',      name: 'João Pedro', handle: '@joaopedro', initials: 'JP', status: 'accepted', blockedAmount: 0,  joinedAt: isoNow() },
      { id: 'usr_003',      name: 'Ana Lima',   handle: '@analima',   initials: 'AL', status: 'accepted', blockedAmount: 0,  joinedAt: isoNow() },
      { id: 'usr_004',      name: 'Carlos',     handle: '@carlos',    initials: 'CM', status: 'pending',  blockedAmount: 0,  joinedAt: null },
      { id: 'usr_005',      name: 'Lucas',      handle: '@lucas_a',   initials: 'LA', status: 'pending',  blockedAmount: 0,  joinedAt: null },
    ],
    items:          [],
    totalLaunched:  0,
    inviteToken:    'tok_abc123',
    inviteDeepLink: 'alber://split/convite/tok_abc123',
    expiresAt:      new Date(Date.now() + 86_400_000).toISOString(),
    createdAt:      isoNow(),
    closedAt:       null,
  },
  {
    id:             'spl_002',
    name:           'Bar da sexta',
    type:           'variable',
    status:         'active',
    ...MOCK_OWNER,
    totalValue:     200,
    participantCount: 4,
    participants: [
      { id: 'usr_mock_001', name: 'Mayte',      handle: '@mayte',     initials: 'MA', status: 'accepted', blockedAmount: 50, joinedAt: isoNow() },
      { id: 'usr_002',      name: 'João Pedro', handle: '@joaopedro', initials: 'JP', status: 'accepted', blockedAmount: 50, joinedAt: isoNow() },
      { id: 'usr_003',      name: 'Ana Lima',   handle: '@analima',   initials: 'AL', status: 'accepted', blockedAmount: 50, joinedAt: isoNow() },
      { id: 'usr_004',      name: 'Carlos',     handle: '@carlos',    initials: 'CM', status: 'pending',  blockedAmount: 0,  joinedAt: null },
    ],
    items: [
      {
        id: 'item_001', description: 'Cerveja — rodada 1',
        totalValue: 60, perPersonValue: 20, participantCount: 3,
        photoUri: null, createdAt: isoNow(),
      },
    ],
    totalLaunched:  60,
    inviteToken:    'tok_def456',
    inviteDeepLink: 'alber://split/convite/tok_def456',
    expiresAt:      new Date(Date.now() + 3_600_000).toISOString(),
    createdAt:      isoNow(),
    closedAt:       null,
  },
]

const DRAFT_INITIAL: SplitDraft = {
  name:             '',
  type:             null,
  totalValue:       0,
  participantCount: 2,
  linkValidity:     '24h',
  customExpiry:     null,
}

// ─── Interface do store ───────────────────────────────────────────────────────

interface SplitState {
  splits:         Split[]
  activeSplitId:  string | null
  draft:          SplitDraft
  loading:        boolean
  error:          string | null

  // ── Rascunho de criação ───────────────────────────────────────────────────
  updateDraft: (patch: Partial<SplitDraft>) => void
  resetDraft:  () => void

  // ── CRUD de splits ────────────────────────────────────────────────────────

  /**
   * Finaliza criação a partir do draft.
   * Dono entra automaticamente como primeiro participante (spec seção 3).
   * Retorna o split criado para navegação.
   */
  createSplit: (owner: { id: string; name: string; handle: string; initials: string }) => Split

  /**
   * Participante entra no split via deep link.
   * Fixo: débito imediato (sem PIN) — spec SP-01.
   * Variável: bloqueia totalValue ÷ participantCount — spec SP-02.
   */
  joinSplit: (splitId: string, participant: Omit<SplitParticipant, 'status' | 'joinedAt'>) => void

  /**
   * Dono fecha o split.
   * Variável: recebe alocações finais por participante — spec seção 5.
   */
  closeSplit: (splitId: string, allocations?: Record<string, number>) => void

  /**
   * Dono lança item no split variável — spec 11.1 + 11.2.
   * Valor dividido imediatamente entre aceitos.
   * Bloqueado se total lançado + item > totalValue — spec SP-17.
   * Retorna false se ultrapassaria o teto.
   */
  launchItem: (
    splitId: string,
    data: { description: string; totalValue: number; photoUri?: string },
  ) => boolean

  /** Atualiza URI da foto de um item — usado após upload confirmar (spec SP-13) */
  setItemPhoto: (splitId: string, itemId: string, photoUri: string) => void

  /**
   * Dono estende prazo do link — spec seção 5.
   */
  extendExpiry: (splitId: string, newExpiry: string) => void

  /**
   * Gera novo token de convite (reenviar link) — spec seção 5.
   */
  renewInviteLink: (splitId: string) => string

  /** Split atualmente em tela de detalhe */
  setActiveSplitId: (id: string | null) => void

  // ── Setters de estado ─────────────────────────────────────────────────────
  setLoading: (loading: boolean) => void
  setError:   (error: string | null) => void

  // ── Getters computados ────────────────────────────────────────────────────
  getActiveSplits:   () => Split[]
  getClosedSplits:   () => Split[]
  getSplitById:      (id: string) => Split | undefined
  /**
   * Valor por pessoa calculado a partir do draft atual.
   * Fixo: totalValue ÷ participantCount.
   * Variável: totalValue ÷ participantCount (valor a bloquear por pessoa).
   */
  getDraftPerPerson: () => number

  /**
   * Quanto ainda pode ser lançado em um split variável.
   * teto - totalLaunched.
   */
  getRemainingBudget: (splitId: string) => number

  /**
   * Parte de cada participante aceito nos itens já lançados.
   * Soma de (item.totalValue ÷ participantCount_no_lançamento) — spec 11.3.
   */
  getMyShare: (splitId: string, userId: string) => number
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSplitStore = create<SplitState>((set, get) => ({
  splits:        MOCK_SPLITS,
  activeSplitId: null,
  draft:         { ...DRAFT_INITIAL },
  loading:       false,
  error:         null,

  // ── Rascunho ───────────────────────────────────────────────────────────────

  updateDraft: (patch) =>
    set(s => ({ draft: { ...s.draft, ...patch } })),

  resetDraft: () =>
    set({ draft: { ...DRAFT_INITIAL } }),

  // ── Criar split ────────────────────────────────────────────────────────────

  createSplit: (owner) => {
    const { draft } = get()
    const token = `tok_${uid()}`
    const ownerParticipant: SplitParticipant = {
      id:            owner.id,
      name:          owner.name,
      handle:        owner.handle,
      initials:      owner.initials,
      status:        'accepted',
      blockedAmount: draft.type === 'variable'
        ? perPersonValue(draft.totalValue, draft.participantCount)
        : 0,
      joinedAt: isoNow(),
    }
    const split: Split = {
      id:               `spl_${uid()}`,
      name:             draft.name,
      type:             draft.type ?? 'fixed',
      status:           'active',
      ownerId:          owner.id,
      ownerHandle:      owner.handle,
      totalValue:       draft.totalValue,
      participantCount: draft.participantCount,
      participants:     [ownerParticipant],
      items:            [],
      totalLaunched:    0,
      inviteToken:      token,
      inviteDeepLink:   `alber://split/convite/${token}`,
      expiresAt:        expiryFromValidity(draft.linkValidity, draft.customExpiry),
      createdAt:        isoNow(),
      closedAt:         null,
    }
    set(s => ({ splits: [split, ...s.splits] }))
    return split
  },

  // ── Entrar no split ────────────────────────────────────────────────────────

  joinSplit: (splitId, participant) =>
    set(s => ({
      splits: s.splits.map(sp => {
        if (sp.id !== splitId || sp.status !== 'active') return sp

        // Recalcula bloqueio para todos ao entrar (spec 11.3)
        const newCount = acceptedCount(sp) + 1
        const remaining = sp.totalValue - sp.totalLaunched
        const newBlock = sp.type === 'variable'
          ? perPersonValue(remaining, newCount)
          : perPersonValue(sp.totalValue, sp.participantCount)

        const updatedParticipants = sp.type === 'variable'
          ? sp.participants.map(p =>
              p.status === 'accepted'
                ? { ...p, blockedAmount: newBlock }
                : p,
            )
          : sp.participants

        const newParticipant: SplitParticipant = {
          ...participant,
          status:        'accepted',
          blockedAmount: newBlock,
          joinedAt:      isoNow(),
        }

        // Auto-fecha split fixo quando todos aderiram (spec seção 6)
        const allJoined =
          sp.type === 'fixed' &&
          updatedParticipants.filter(p => p.status === 'accepted').length + 1 >=
            sp.participantCount

        return {
          ...sp,
          participants: [...updatedParticipants, newParticipant],
          status: allJoined ? 'closed' : sp.status,
          closedAt: allJoined ? isoNow() : sp.closedAt,
        }
      }),
    })),

  // ── Fechar split ───────────────────────────────────────────────────────────

  closeSplit: (splitId, _allocations) =>
    set(s => ({
      splits: s.splits.map(sp =>
        sp.id === splitId
          ? { ...sp, status: 'closed', closedAt: isoNow() }
          : sp,
      ),
    })),

  // ── Lançar item (variável) ─────────────────────────────────────────────────

  launchItem: (splitId, data) => {
    const split = get().getSplitById(splitId)
    if (!split || split.type !== 'variable') return false

    const wouldExceed = split.totalLaunched + data.totalValue > split.totalValue
    if (wouldExceed) return false   // spec SP-17

    const accepted = acceptedCount(split)
    const ppv = accepted > 0 ? data.totalValue / accepted : data.totalValue

    const item: SplitItem = {
      id:               `item_${uid()}`,
      description:      data.description,
      totalValue:       data.totalValue,
      perPersonValue:   Math.ceil(ppv * 100) / 100,
      participantCount: accepted,
      photoUri:         data.photoUri ?? null,
      createdAt:        isoNow(),
    }

    set(s => ({
      splits: s.splits.map(sp =>
        sp.id !== splitId
          ? sp
          : {
              ...sp,
              items:         [...sp.items, item],
              totalLaunched: sp.totalLaunched + data.totalValue,
            },
      ),
    }))
    return true
  },

  // ── Foto de item ───────────────────────────────────────────────────────────

  setItemPhoto: (splitId, itemId, photoUri) =>
    set(s => ({
      splits: s.splits.map(sp =>
        sp.id !== splitId
          ? sp
          : {
              ...sp,
              items: sp.items.map(it =>
                it.id === itemId ? { ...it, photoUri } : it,
              ),
            },
      ),
    })),

  // ── Prazo e link ──────────────────────────────────────────────────────────

  extendExpiry: (splitId, newExpiry) =>
    set(s => ({
      splits: s.splits.map(sp =>
        sp.id === splitId ? { ...sp, expiresAt: newExpiry } : sp,
      ),
    })),

  renewInviteLink: (splitId) => {
    const token = `tok_${uid()}`
    set(s => ({
      splits: s.splits.map(sp =>
        sp.id !== splitId
          ? sp
          : {
              ...sp,
              inviteToken:    token,
              inviteDeepLink: `alber://split/convite/${token}`,
            },
      ),
    }))
    return `alber://split/convite/${token}`
  },

  // ── Navegação ─────────────────────────────────────────────────────────────

  setActiveSplitId: (id) => set({ activeSplitId: id }),

  // ── Estado ────────────────────────────────────────────────────────────────

  setLoading: (loading) => set({ loading }),
  setError:   (error)   => set({ error }),

  // ── Getters ───────────────────────────────────────────────────────────────

  getActiveSplits: () =>
    get().splits.filter(sp => sp.status === 'active'),

  getClosedSplits: () =>
    get().splits.filter(sp => sp.status === 'closed' || sp.status === 'expired'),

  getSplitById: (id) =>
    get().splits.find(sp => sp.id === id),

  getDraftPerPerson: () => {
    const { draft } = get()
    return perPersonValue(draft.totalValue, draft.participantCount)
  },

  getRemainingBudget: (splitId) => {
    const sp = get().getSplitById(splitId)
    if (!sp || sp.type !== 'variable') return 0
    return sp.totalValue - sp.totalLaunched
  },

  getMyShare: (splitId, userId) => {
    const sp = get().getSplitById(splitId)
    if (!sp) return 0
    // Soma do item.perPersonValue para cada item lançado enquanto o user era aceito
    // Simplificação: se o user está aceito, somamos todos os itens
    const isAccepted = sp.participants.some(
      p => p.id === userId && p.status === 'accepted',
    )
    if (!isAccepted) return 0
    return sp.items.reduce((acc, it) => acc + it.perPersonValue, 0)
  },
}))
