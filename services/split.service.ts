// Spec: /specs/06_modules/split.md
// Camada HTTP entre app e Edge Functions / Supabase REST do módulo Split

import { BffError } from './auth.service'
import type { Split, SplitItem, SplitParticipant } from '../store/split.store'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const REST     = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/rest/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function bffHeaders(token: string): Record<string, string> {
  return {
    'Content-Type':  'application/json',
    'apikey':        ANON_KEY,
    'Authorization': `Bearer ${token}`,
  }
}

function restHeaders(token: string): Record<string, string> {
  return {
    'apikey':        ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Accept':        'application/json',
  }
}

async function bffPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res  = await fetch(`${BFF}/${path}`, {
    method:  'POST',
    headers: bffHeaders(token),
    body:    JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new BffError(String(data.code ?? 'UNKNOWN'), String(data.message ?? 'Erro'), res.status)
  return data as T
}

async function restGet<T>(endpoint: string, token: string): Promise<T> {
  const res = await fetch(`${REST}/${endpoint}`, { method: 'GET', headers: restHeaders(token) })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new BffError('REST_ERROR', String(data.message ?? 'Erro'), res.status)
  }
  return res.json() as Promise<T>
}

async function restRpc<T>(fn: string, args: unknown, token: string): Promise<T> {
  const res = await fetch(`${REST}/rpc/${fn}`, {
    method:  'POST',
    headers: { ...restHeaders(token), 'Content-Type': 'application/json' },
    body:    JSON.stringify(args),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new BffError('REST_ERROR', String(data.message ?? 'Erro'), res.status)
  }
  return res.json() as Promise<T>
}

// ── Interfaces de entrada ─────────────────────────────────────────────────────

export interface CreateSplitInput {
  name:              string
  type:              'fixed' | 'variable'
  target_amount:     number
  max_participants:  number
  invite_expires_at: string
}

export interface LaunchItemInput {
  split_id:    string
  description: string
  value:       number
  photo_url?:  string
}

// ── Interfaces de saída ───────────────────────────────────────────────────────

export interface CreateSplitResponse {
  split_id:     string
  invite_token: string
  invite_url:   string
}

export interface JoinSplitResponse {
  split_id:          string
  name:              string
  type:              'fixed' | 'variable'
  target_amount:     number
  status:            string
  your_amount:       number
  participants:      Array<{ user_id: string; status: string; blocked_amount: number; joined_at: string }>
  invite_expires_at: string
}

export interface LaunchItemResponse {
  item_id:           string
  description:       string
  value:             number
  value_per_person:  number
  participant_count: number
  total_launched:    number
  remaining_budget:  number
}

// ── Tipos internos (PostgREST / RPC response) ────────────────────────────────

interface DbParticipant {
  user_id:          string
  status:           'accepted' | 'pending'
  blocked_amount:   string
  joined_at:        string | null
  participant_user: { name: string; handle: string } | null
}

interface DbItem {
  id:                string
  description:       string
  value:             string
  value_per_person:  string
  participant_count: number
  photo_url:         string | null
  created_at:        string
}

interface DbSplit {
  id:                string
  name:              string
  type:              'fixed' | 'variable'
  status:            'open' | 'closed' | 'expired'
  owner_id:          string
  target_amount:     string
  max_participants:  number
  invite_token:      string
  invite_expires_at: string
  created_at:        string
  closed_at:         string | null
  owner:             { handle: string } | null
  split_participants: DbParticipant[]
  split_items:        DbItem[]
}

// ── Mapeamento DB → tipos do store ────────────────────────────────────────────

function mapParticipant(p: DbParticipant): SplitParticipant {
  const name   = p.participant_user?.name ?? 'Usuário'
  const handle = p.participant_user?.handle ?? ''
  return {
    id:            p.user_id,
    name,
    handle,
    initials:      name.substring(0, 2).toUpperCase(),
    status:        p.status,
    blockedAmount: Number(p.blocked_amount),
    joinedAt:      p.joined_at,
  }
}

function mapItem(it: DbItem): SplitItem {
  return {
    id:               it.id,
    description:      it.description,
    totalValue:       Number(it.value),
    perPersonValue:   Number(it.value_per_person),
    participantCount: it.participant_count,
    photoUri:         it.photo_url,
    createdAt:        it.created_at,
  }
}

function mapSplit(db: DbSplit): Split {
  const items         = (db.split_items ?? []).map(mapItem)
  const participants  = (db.split_participants ?? []).map(mapParticipant)
  const totalLaunched = items.reduce((s, it) => s + it.totalValue, 0)
  const status        = db.status === 'open' ? 'active' : db.status === 'expired' ? 'expired' : 'closed'

  return {
    id:               db.id,
    name:             db.name,
    type:             db.type,
    status,
    ownerId:          db.owner_id,
    ownerHandle:      db.owner?.handle ?? '',
    totalValue:       Number(db.target_amount),
    participantCount: db.max_participants,
    participants,
    items,
    totalLaunched,
    inviteToken:      db.invite_token,
    inviteDeepLink:   `alber://split/convite/${db.invite_token}`,
    expiresAt:        db.invite_expires_at,
    createdAt:        db.created_at,
    closedAt:         db.closed_at,
  }
}

// Resposta da RPC get_split_preview (migration 014)
interface DbSplitPreview {
  id:                string
  name:              string
  type:              string
  target_amount:     string
  max_participants:  number
  invite_expires_at: string
  invite_token:      string
  total_launched:    string
  owner_handle:      string
  participants:      Array<{ user_id: string; status: string; handle: string; name: string }> | null
}

function mapSplitPreview(db: DbSplitPreview): Split {
  const participants: SplitParticipant[] = (db.participants ?? []).map(p => ({
    id:            p.user_id,
    name:          p.name,
    handle:        p.handle,
    initials:      p.name.substring(0, 2).toUpperCase(),
    status:        'accepted' as const,
    blockedAmount: 0,
    joinedAt:      null,
  }))

  return {
    id:               db.id,
    name:             db.name,
    type:             db.type as 'fixed' | 'variable',
    status:           'active',
    ownerId:          '',  // não retornado no preview
    ownerHandle:      db.owner_handle,
    totalValue:       Number(db.target_amount),
    participantCount: db.max_participants,
    participants,
    items:            [],
    totalLaunched:    Number(db.total_launched),
    inviteToken:      db.invite_token,
    inviteDeepLink:   `alber://split/convite/${db.invite_token}`,
    expiresAt:        db.invite_expires_at,
    createdAt:        '',
    closedAt:         null,
  }
}

// Campos selecionados em todas as queries REST de split
const SPLIT_SELECT = [
  'id', 'name', 'type', 'status', 'owner_id', 'target_amount',
  'max_participants', 'invite_token', 'invite_expires_at', 'created_at', 'closed_at',
  'owner:users!splits_owner_id_fkey(handle)',
  'split_participants(user_id,status,blocked_amount,joined_at,' +
    'participant_user:users!split_participants_user_id_fkey(name,handle))',
  'split_items(id,description,value,value_per_person,participant_count,photo_url,created_at)',
].join(',')

// ── Write: Edge Functions ─────────────────────────────────────────────────────

export async function createSplit(data: CreateSplitInput, token: string): Promise<CreateSplitResponse> {
  return bffPost<CreateSplitResponse>('split-create', data, token)
}

export async function joinSplit(inviteToken: string, token: string): Promise<JoinSplitResponse> {
  return bffPost<JoinSplitResponse>('split-join', { invite_token: inviteToken }, token)
}

export async function launchItem(data: LaunchItemInput, token: string): Promise<LaunchItemResponse> {
  return bffPost<LaunchItemResponse>('split-launch', data, token)
}

export async function closeSplit(
  splitId:     string,
  allocations: Record<string, number>,
  pinHash:     string,
  token:       string,
): Promise<void> {
  await bffPost<{ ok: true }>('split-close', { split_id: splitId, allocations, pin_hash: pinHash }, token)
}

// ── Read: Supabase REST ───────────────────────────────────────────────────────

export async function getMySplits(token: string): Promise<Split[]> {
  const rows = await restGet<DbSplit[]>(
    `splits?select=${encodeURIComponent(SPLIT_SELECT)}&order=created_at.desc`,
    token,
  )
  return rows.map(mapSplit)
}

export async function getSplit(splitId: string, token: string): Promise<Split | null> {
  const rows = await restGet<DbSplit[]>(
    `splits?select=${encodeURIComponent(SPLIT_SELECT)}&id=eq.${splitId}&limit=1`,
    token,
  )
  return rows[0] ? mapSplit(rows[0]) : null
}

export async function getSplitByToken(inviteToken: string, token: string): Promise<Split | null> {
  // Usa RPC SECURITY DEFINER para visualizar o preview sem ser participante (migration 014)
  const rows = await restRpc<DbSplitPreview[]>(
    'get_split_preview',
    { p_invite_token: inviteToken },
    token,
  )
  return rows[0] ? mapSplitPreview(rows[0]) : null
}
