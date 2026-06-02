// Spec: /specs/06_modules/split.md
// Zustand store do módulo Split — conectado ao backend real (Sprint 4)

import { create } from 'zustand'
import * as splitService from '../services/split.service'
import { BffError } from '../services/auth.service'

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
  blockedAmount: number
  joinedAt:      string | null
}

export interface SplitItem {
  id:               string
  description:      string
  totalValue:       number
  perPersonValue:   number
  participantCount: number
  photoUri:         string | null
  createdAt:        string
}

export interface Split {
  id:               string
  name:             string
  type:             SplitType
  status:           SplitStatus
  ownerId:          string
  ownerHandle:      string
  totalValue:       number
  participantCount: number
  participants:     SplitParticipant[]
  items:            SplitItem[]
  totalLaunched:    number
  inviteToken:      string
  inviteDeepLink:   string
  expiresAt:        string
  createdAt:        string
  closedAt:         string | null
}

export interface SplitDraft {
  name:             string
  type:             SplitType | null
  totalValue:       number
  participantCount: number
  linkValidity:     LinkValidity
  customExpiry:     string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function expiryFromValidity(validity: LinkValidity, custom: string | null): string {
  if (validity === 'custom' && custom) return custom
  const lookup: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 }
  return new Date(Date.now() + (lookup[validity] ?? 3_600_000)).toISOString()
}

function perPersonValue(totalValue: number, participantCount: number): number {
  if (participantCount <= 0) return 0
  return Math.ceil((totalValue / participantCount) * 100) / 100
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof BffError ? e.message : fallback
}

// ─── Estado inicial ───────────────────────────────────────────────────────────

const DRAFT_INITIAL: SplitDraft = {
  name:             '',
  type:             null,
  totalValue:       0,
  participantCount: 2,
  linkValidity:     '24h',
  customExpiry:     null,
}

// ─── Interface ────────────────────────────────────────────────────────────────

interface SplitState {
  splits:        Split[]
  activeSplitId: string | null
  draft:         SplitDraft
  loading:       boolean
  error:         string | null

  // ── Rascunho de criação ───────────────────────────────────────────────────
  updateDraft: (patch: Partial<SplitDraft>) => void
  resetDraft:  () => void

  // ── Ações assíncronas (backend real) ──────────────────────────────────────

  /** Carrega todos os splits do usuário (dono + participante). */
  fetchMySplits: (token: string) => Promise<void>

  /** Busca/atualiza um split específico pelo ID. */
  fetchSplit: (id: string, token: string) => Promise<void>

  /**
   * Finaliza criação a partir do draft.
   * Retorna { split_id, invite_token, invite_url } para navegação.
   */
  createSplit: (token: string) => Promise<splitService.CreateSplitResponse>

  /**
   * Participante entra no split via invite_token do deep link.
   * Retorna dados do split + sua quota (fixo: débito Asaas | variável: bloqueio).
   */
  joinSplit: (inviteToken: string, token: string) => Promise<splitService.JoinSplitResponse>

  /**
   * Dono lança item no split variável.
   * Retorna item criado + orçamento restante.
   */
  launchItem: (data: splitService.LaunchItemInput, token: string) => Promise<splitService.LaunchItemResponse>

  /**
   * Dono fecha split variável com alocações finais.
   * Requer PIN para autorização.
   */
  closeSplit: (
    splitId:     string,
    allocations: Record<string, number>,
    pinHash:     string,
    token:       string,
  ) => Promise<void>

  // ── Ações locais (UX / sem Edge Function no MVP) ─────────────────────────

  /** Atualiza URI da foto de um item após upload confirmar. */
  setItemPhoto: (splitId: string, itemId: string, photoUri: string) => void

  setActiveSplitId: (id: string | null) => void
  setLoading:       (loading: boolean) => void
  setError:         (error: string | null) => void

  // ── Getters computados ────────────────────────────────────────────────────
  getActiveSplits:    () => Split[]
  getClosedSplits:    () => Split[]
  getSplitById:       (id: string) => Split | undefined
  getDraftPerPerson:  () => number
  getRemainingBudget: (splitId: string) => number
  getMyShare:         (splitId: string, userId: string) => number
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSplitStore = create<SplitState>((set, get) => ({
  splits:        [],
  activeSplitId: null,
  draft:         { ...DRAFT_INITIAL },
  loading:       false,
  error:         null,

  // ── Rascunho ───────────────────────────────────────────────────────────────

  updateDraft: (patch) => set(s => ({ draft: { ...s.draft, ...patch } })),
  resetDraft:  ()      => set({ draft: { ...DRAFT_INITIAL } }),

  // ── Fetch ─────────────────────────────────────────────────────────────────

  fetchMySplits: async (token) => {
    set({ loading: true, error: null })
    try {
      const splits = await splitService.getMySplits(token)
      set({ splits, loading: false })
    } catch (e) {
      set({ error: errorMessage(e, 'Erro ao carregar splits'), loading: false })
    }
  },

  fetchSplit: async (id, token) => {
    try {
      const split = await splitService.getSplit(id, token)
      if (!split) return
      set(s => ({
        splits: s.splits.some(sp => sp.id === id)
          ? s.splits.map(sp => (sp.id === id ? split : sp))
          : [split, ...s.splits],
      }))
    } catch (e) {
      console.warn('[split.store] fetchSplit error:', e)
    }
  },

  // ── Criar split ────────────────────────────────────────────────────────────

  createSplit: async (token) => {
    const { draft } = get()
    set({ loading: true, error: null })
    try {
      const res = await splitService.createSplit(
        {
          name:              draft.name.trim(),
          type:              draft.type ?? 'fixed',
          target_amount:     draft.totalValue,
          max_participants:  draft.participantCount,
          invite_expires_at: expiryFromValidity(draft.linkValidity, draft.customExpiry),
        },
        token,
      )
      set({ loading: false })
      return res
    } catch (e) {
      set({ error: errorMessage(e, 'Erro ao criar split'), loading: false })
      throw e
    }
  },

  // ── Entrar no split ────────────────────────────────────────────────────────

  joinSplit: async (inviteToken, token) => {
    set({ loading: true, error: null })
    try {
      const res = await splitService.joinSplit(inviteToken, token)
      set({ loading: false })
      return res
    } catch (e) {
      set({ error: errorMessage(e, 'Erro ao entrar no split'), loading: false })
      throw e
    }
  },

  // ── Lançar item (variável) ─────────────────────────────────────────────────

  launchItem: async (data, token) => {
    set({ loading: true, error: null })
    try {
      const res = await splitService.launchItem(data, token)
      // Atualiza totalLaunched e items no split local sem re-fetch completo
      set(s => ({
        loading: false,
        splits: s.splits.map(sp => {
          if (sp.id !== data.split_id) return sp
          const newItem: SplitItem = {
            id:               res.item_id,
            description:      res.description,
            totalValue:       res.value,
            perPersonValue:   res.value_per_person,
            participantCount: res.participant_count,
            photoUri:         data.photo_url ?? null,
            createdAt:        new Date().toISOString(),
          }
          return {
            ...sp,
            items:         [...sp.items, newItem],
            totalLaunched: res.total_launched,
          }
        }),
      }))
      return res
    } catch (e) {
      set({ error: errorMessage(e, 'Erro ao lançar item'), loading: false })
      throw e
    }
  },

  // ── Fechar split ───────────────────────────────────────────────────────────

  closeSplit: async (splitId, allocations, pinHash, token) => {
    set({ loading: true, error: null })
    try {
      await splitService.closeSplit(splitId, allocations, pinHash, token)
      const now = new Date().toISOString()
      set(s => ({
        loading: false,
        splits: s.splits.map(sp =>
          sp.id === splitId ? { ...sp, status: 'closed' as SplitStatus, closedAt: now } : sp,
        ),
      }))
    } catch (e) {
      set({ error: errorMessage(e, 'Erro ao fechar split'), loading: false })
      throw e
    }
  },

  // ── Foto de item ───────────────────────────────────────────────────────────

  setItemPhoto: (splitId, itemId, photoUri) =>
    set(s => ({
      splits: s.splits.map(sp =>
        sp.id !== splitId
          ? sp
          : { ...sp, items: sp.items.map(it => (it.id === itemId ? { ...it, photoUri } : it)) },
      ),
    })),

  // ── Navegação + estado ────────────────────────────────────────────────────

  setActiveSplitId: (id)     => set({ activeSplitId: id }),
  setLoading:       (loading) => set({ loading }),
  setError:         (error)   => set({ error }),

  // ── Getters ───────────────────────────────────────────────────────────────

  getActiveSplits: () => get().splits.filter(sp => sp.status === 'active'),

  getClosedSplits: () => get().splits.filter(sp => sp.status === 'closed' || sp.status === 'expired'),

  getSplitById: (id) => get().splits.find(sp => sp.id === id),

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
    const isAccepted = sp.participants.some(p => p.id === userId && p.status === 'accepted')
    if (!isAccepted) return 0
    return sp.items.reduce((acc, it) => acc + it.perPersonValue, 0)
  },
}))
