// Spec: /specs/06_modules/alber_lounge.md
// Camada HTTP entre app e Edge Functions / Supabase REST do módulo Lounge

import { BffError } from './auth.service'
import type { Lounge, LoungeMember, LoungeRequest } from '../store/lounge.store'
import type { LoungeEvent, EventBatch } from '../components/lounge/EventCard'
import type { LoungeRole } from '../components/lounge/LoungeCard'

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const REST     = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/rest/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// ── HTTP helpers ──────────────────────────────────────────────────────────────

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
    throw new BffError('REST_ERROR', String(data.message ?? 'Erro ao carregar dados'), res.status)
  }
  return res.json() as Promise<T>
}

// ── DB types ──────────────────────────────────────────────────────────────────

interface DbSkin { accent?: string; bgDark?: string }

interface DbBatch {
  id:           string
  batch_number: number
  batch_type:   'quantity' | 'date'
  price_brl:    string
  capacity:     number
  sold:         number
  valid_until:  string | null
  status:       'pending' | 'active' | 'sold_out' | 'expired'
}

interface DbEvent {
  id:              string
  name:            string
  description:     string | null
  image_url:       string | null
  date:            string
  visibility:      'members' | 'public'
  is_paid:         boolean
  is_recurring:    boolean
  recurrence_freq: string | null
  status:          'active' | 'cancelled'
  created_at:      string
  event_batches:   DbBatch[]
}

interface DbSpaceMember {
  id:        string
  user_id:   string
  role:      'owner' | 'admin' | 'member'
  status:    'pending' | 'active' | 'banned'
  joined_at: string | null
  created_at: string
  member:    { id: string; name: string; handle: string } | null
}

interface DbSpace {
  id:           string
  name:         string
  type:         'open' | 'closed'
  description:  string | null
  image_url:    string | null
  invite_token: string | null
  skin:         DbSkin
  owner_id:     string
  status:       string
  created_at:   string
  space_members: DbSpaceMember[]
  events:        DbEvent[]
}

interface DbMyMembership {
  id:     string
  role:   'owner' | 'admin' | 'member'
  status: 'pending' | 'active' | 'banned'
  space:  Omit<DbSpace, 'space_members' | 'events'>
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

function mapRole(db: 'owner' | 'admin' | 'member'): LoungeRole {
  return db === 'admin' ? 'manager' : db
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

function formatEventDate(iso: string): string {
  try {
    const d = new Date(iso)
    const base = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    return `${base} · ${h}h${m}`
  } catch {
    return iso
  }
}

function formatValidUntil(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`
  } catch {
    return iso
  }
}

function mapBatch(b: DbBatch): EventBatch {
  return {
    id:          b.id,
    name:        `${b.batch_number}º Lote`,
    batchNumber: b.batch_number,
    batchType:   b.batch_type,
    priceBrl:    Number(b.price_brl),
    priceAlbers: Number(b.price_brl), // paridade 1:1 no MVP
    capacity:    b.capacity,
    sold:        b.sold,
    validUntil:  b.valid_until ? formatValidUntil(b.valid_until) : null,
    status:      b.status,
  }
}

function mapEvent(e: DbEvent, spaceId: string): LoungeEvent {
  const batches = (e.event_batches ?? [])
    .sort((a, b) => a.batch_number - b.batch_number)
    .map(mapBatch)
  return {
    id:             e.id,
    loungeId:       spaceId,
    name:           e.name,
    description:    e.description ?? '',
    imageUri:       e.image_url ?? null,
    date:           formatEventDate(e.date),
    visibility:     e.visibility === 'members' ? 'members_only' : 'public',
    isPaid:         e.is_paid,
    isRecurring:    e.is_recurring ?? false,
    recurrenceFreq: e.recurrence_freq ?? null,
    batches,
    totalCapacity:  batches.reduce((s, b) => s + b.capacity, 0),
    confirmed:      batches.reduce((s, b) => s + b.sold, 0),
    status:         e.status,
    createdAt:      e.created_at,
  }
}

function mapSpaceFull(s: DbSpace, myUserId: string): Lounge {
  const skin          = s.skin ?? {}
  const allMembers    = s.space_members ?? []
  const activeMembers = allMembers.filter(m => m.status === 'active')
  const pending       = allMembers.filter(m => m.status === 'pending')
  const myMembership  = allMembers.find(m => m.user_id === myUserId)

  return {
    id:          s.id,
    name:        s.name,
    description: s.description ?? '',
    accent:      skin.accent  ?? '#5BCEC9',
    bgDark:      skin.bgDark  ?? '#0a0a0a',
    imageUri:    s.image_url  ?? null,
    visibility:  s.type === 'open' ? 'public' : 'private',
    memberCount: activeMembers.length,
    role:        myMembership ? mapRole(myMembership.role) : null,
    ownerId:     s.owner_id,
    members: activeMembers.map<LoungeMember>(m => ({
      id:       m.member?.id  ?? m.user_id,
      name:     m.member?.name ?? '',
      handle:   m.member?.handle ?? '',
      initials: getInitials(m.member?.name ?? '?'),
      role:     mapRole(m.role),
      joinedAt: m.joined_at ?? m.created_at,
    })),
    pendingRequests: pending.map<LoungeRequest>(m => ({
      id:          m.id,
      userId:      m.user_id,
      name:        m.member?.name ?? '',
      handle:      m.member?.handle ?? '',
      initials:    getInitials(m.member?.name ?? '?'),
      requestedAt: m.created_at,
    })),
    events:      (s.events ?? [])
      .filter(e => e.status === 'active')
      .map(e => mapEvent(e, s.id)),
    messages:    [],
    inviteToken: s.invite_token ?? null,
    createdAt:   s.created_at,
  }
}

function mapLoungeListItem(sm: DbMyMembership): Lounge {
  const s    = sm.space
  const skin = s.skin ?? {}
  return {
    id:              s.id,
    name:            s.name,
    description:     s.description ?? '',
    accent:          skin.accent  ?? '#5BCEC9',
    bgDark:          skin.bgDark  ?? '#0a0a0a',
    imageUri:        s.image_url  ?? null,
    visibility:      s.type === 'open' ? 'public' : 'private',
    memberCount:     0,
    role:            mapRole(sm.role),
    ownerId:         s.owner_id,
    members:         [],
    pendingRequests: [],
    events:          [],
    messages:        [],
    inviteToken:     s.invite_token ?? null,
    createdAt:       s.created_at,
  }
}

// ── Write functions (Edge Functions) ──────────────────────────────────────────

export interface CreateLoungeInput {
  name:        string
  type:        'open' | 'closed'
  description: string
  skin:        { accent: string; bgDark: string }
  image_url?:  string | null
}

export interface CreateLoungeResponse {
  space_id:     string
  name:         string
  type:         string
  invite_token: string | null
}

export interface JoinLoungeResponse {
  status:   'pending' | 'active'
  space_id: string
}

export interface CreateEventInput {
  space_id:         string
  name:             string
  description?:     string
  date:             string
  visibility:       'members' | 'public'
  is_paid:          boolean
  is_recurring?:    boolean
  recurrence_freq?: string
  batches?: {
    batch_type:   'quantity' | 'date'
    price_brl:    number
    capacity:     number
    valid_until?: string
  }[]
}

export interface BuyTicketResponse {
  ticket_id:    string
  event_id:     string
  batch_id:     string
  price_brl:    number
  price_albers: number
  purchased_at: string
}

export async function createLounge(data: CreateLoungeInput, token: string): Promise<CreateLoungeResponse> {
  return bffPost('lounge-create', data, token)
}

export async function joinLounge(
  params: { space_id?: string; invite_token?: string },
  token: string,
): Promise<JoinLoungeResponse> {
  return bffPost('lounge-join', params, token)
}

export async function approveMember(member_id: string, approved: boolean, token: string): Promise<void> {
  await bffPost('lounge-approve', { member_id, approved }, token)
}

export async function createEvent(data: CreateEventInput, token: string): Promise<{ event_id: string }> {
  return bffPost('event-create', data, token)
}

export async function buyTicket(
  event_id: string,
  pin_hash: string | undefined,
  token: string,
): Promise<BuyTicketResponse> {
  return bffPost('event-ticket', { event_id, pin_hash }, token)
}

// ── Read functions (Supabase REST) ────────────────────────────────────────────

const SPACE_FULL_SELECT = [
  'id', 'name', 'type', 'description', 'image_url', 'invite_token', 'skin', 'owner_id', 'status', 'created_at',
  'space_members(id,user_id,role,status,joined_at,created_at,member:users!space_members_user_id_fkey(id,name,handle))',
  'events(id,name,description,image_url,date,visibility,is_paid,is_recurring,recurrence_freq,status,created_at,' +
    'event_batches(id,batch_number,batch_type,price_brl,capacity,sold,valid_until,status))',
].join(',')

export async function getMyLounges(token: string): Promise<Lounge[]> {
  const rows = await restGet<DbMyMembership[]>(
    'space_members?select=id,role,status,' +
    'space:spaces!space_members_space_id_fkey(id,name,type,description,image_url,invite_token,skin,owner_id,status,created_at)' +
    '&status=eq.active&order=created_at.asc',
    token,
  )
  return rows.map(mapLoungeListItem)
}

export async function getLounge(id: string, myUserId: string, token: string): Promise<Lounge | null> {
  const rows = await restGet<DbSpace[]>(
    `spaces?select=${encodeURIComponent(SPACE_FULL_SELECT)}&id=eq.${id}`,
    token,
  )
  if (!rows.length) return null
  return mapSpaceFull(rows[0], myUserId)
}

export async function getExploring(query: string, token: string): Promise<Lounge[]> {
  const filter = query.trim() ? `&name=ilike.*${encodeURIComponent(query.trim())}*` : ''
  const rows = await restGet<Omit<DbSpace, 'space_members' | 'events'>[]>(
    `spaces?select=id,name,type,description,image_url,skin,owner_id,status,created_at&type=eq.open&status=eq.active${filter}&order=created_at.desc`,
    token,
  )
  return rows.map(s => mapSpaceFull(
    { ...s, space_members: [], events: [], invite_token: null },
    '',
  ))
}
