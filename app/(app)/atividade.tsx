// Design: /design/flows-rest.jsx — AtividadeScreen
// Spec: /specs/06_modules/atividade.md
// Histórico de movimentações com filtros, paginação infinita, agrupamento por data e detalhe

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/auth.store'
import { useBalanceStore } from '../../store/balance.store'
import { Header } from '../../components/core/Header'
import { Eyebrow } from '../../components/shared/Eyebrow'
import { AsaasBadge } from '../../components/shared/AsaasBadge'
import { colors } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TxType =
  | 'carregar' | 'descarregar'
  | 'receber'  | 'enviar'
  | 'split_block' | 'split_release' | 'split_debit'
  | 'event_purchase' | 'event_refund'
  | 'fee'

export interface Transaction {
  id:         string
  type:       TxType
  desc:       string
  sub:        string
  amount:     number
  date:       string   // ISO
  handle?:    string
  splitId?:   string
  splitName?: string
  eventId?:   string
  eventName?: string
  eventDate?: string
  fee?:       number
  gross?:     number
}

type Filter = 'all' | 'in' | 'out' | 'split' | 'ticket'

// ─── Constantes ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

const FILTER_TYPES: Record<Filter, TxType[]> = {
  all:    ['carregar','descarregar','receber','enviar','split_block','split_release','split_debit','event_purchase','event_refund','fee'],
  in:     ['carregar','receber','split_release','event_refund'],
  out:    ['descarregar','enviar','split_debit','event_purchase','fee'],
  split:  ['split_block','split_release','split_debit'],
  ticket: ['event_purchase','event_refund'],
}

const IN_TYPES  = new Set<TxType>(['carregar','receber','split_release','event_refund'])
const OUT_TYPES = new Set<TxType>(['descarregar','enviar','split_block','split_debit','event_purchase','fee'])

// ─── Icons ────────────────────────────────────────────────────────────────────

const TX_ICON: Record<TxType, string> = {
  carregar:       '↓',
  descarregar:    '↑',
  receber:        '↓',
  enviar:         '↑',
  split_block:    '🔒',
  split_release:  '🔓',
  split_debit:    '⚡',
  event_purchase: '🎫',
  event_refund:   '🎫',
  fee:            '%',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function txColor(type: TxType, amount: number): string {
  if (type === 'split_block') return colors.warning[500]
  if (amount > 0) return colors.state.success
  return colors.white[100]
}

function txSign(type: TxType, amount: number): string {
  if (type === 'split_block') return `−${Math.abs(amount)}`
  if (amount > 0) return `+${amount}`
  return `${amount}`
}

function formatDateGroup(iso: string): string {
  const d   = new Date(iso)
  const now = new Date()
  const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const txDay  = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff   = today.getTime() - txDay.getTime()
  if (diff === 0) return 'HOJE'
  if (diff === 86_400_000) return 'ONTEM'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).toUpperCase()
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface TxGroup { date: string; items: Transaction[] }

function groupByDate(txns: Transaction[]): TxGroup[] {
  const map = new Map<string, Transaction[]>()
  for (const tx of txns) {
    const label = formatDateGroup(tx.date)
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(tx)
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }))
}

// ─── API mapping ──────────────────────────────────────────────────────────────

interface ApiTx {
  id:           string
  type:         string
  amount:       number
  fee:          number
  status:       string
  created_at:   string
  reference_id: string | null
  metadata:     Record<string, string>
  counterpart:  { name: string; handle: string } | null
}

function mapApiTx(row: ApiTx): Transaction {
  const m    = row.metadata ?? {}
  const type = row.type as TxType

  // Determinar desc + sub por tipo
  let desc = ''
  let sub  = ''

  switch (type) {
    case 'receber':
      desc = row.counterpart?.handle ?? m.payer_handle ?? 'Albers recebidos'
      sub  = row.fee ? `Albers · taxa −${row.fee}` : 'Albers recebidos'
      break
    case 'enviar':
      desc = row.counterpart?.handle ?? m.receiver_handle ?? 'Albers enviados'
      sub  = row.fee ? `Albers · taxa −${row.fee}` : 'Albers enviados'
      break
    case 'carregar':
      desc = 'Carga via Pix'
      sub  = ''
      break
    case 'descarregar':
      desc = 'Pix enviado'
      sub  = m.pix_key ? `Para chave ${m.pix_key_type ?? ''} ${m.pix_key}`.trim() : 'Pix enviado'
      break
    case 'split_block':
      desc = m.split_name ?? 'Split'
      sub  = 'Reservado · split'
      break
    case 'split_release':
      desc = m.split_name ?? 'Split'
      sub  = 'Excedente devolvido'
      break
    case 'split_debit':
      desc = m.split_name ?? 'Split'
      sub  = 'Débito final'
      break
    case 'event_purchase':
      desc = m.event_name ?? 'Ingresso'
      sub  = ''
      break
    case 'event_refund':
      desc = m.event_name ?? 'Ingresso'
      sub  = 'Reembolso · cancelamento'
      break
    case 'fee':
      desc = 'Taxa'
      sub  = m.source === 'receber_fee' ? 'Taxa de recebimento' : 'Taxa de operação'
      break
    default:
      desc = type
      sub  = ''
  }

  // Sinalizar amount: in-types positivo, out-types negativo
  const absAmount = Math.abs(row.amount)
  const amount    = IN_TYPES.has(type) ? absAmount : -absAmount

  return {
    id:        row.id,
    type,
    desc,
    sub,
    amount,
    date:      row.created_at,
    handle:    row.counterpart?.handle,
    splitId:   m.split_id,
    splitName: m.split_name,
    eventId:   m.event_id,
    eventName: m.event_name,
    fee:       row.fee || undefined,
    gross:     row.fee ? absAmount + row.fee : undefined,
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

const BFF      = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1'
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

async function fetchAtividade(
  token: string,
  tipo: Filter,
  page: number,
  limit: number,
): Promise<{ data: Transaction[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({
    tipo,
    page:  String(page),
    limit: String(limit),
  })
  const res  = await fetch(`${BFF}/financial-atividade?${params}`, {
    method:  'GET',
    headers: {
      'apikey':        ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? 'Erro ao buscar atividades')
  return {
    data:    (json.data ?? []).map(mapApiTx),
    total:   json.total ?? 0,
    hasMore: json.hasMore ?? false,
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AtividadeScreen() {
  const { t }   = useTranslation()
  const insets  = useSafeAreaInsets()

  const token    = useAuthStore(s => s.token)
  const balance  = useBalanceStore(s => s.balance)
  const reserved = useBalanceStore(s => s.blocked)

  const [filter, setFilter]         = useState<Filter>('all')
  const [transactions, setTx]       = useState<Transaction[]>([])
  const [page, setPage]             = useState(0)
  const [hasMore, setHasMore]       = useState(false)
  const [loading, setLoading]       = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [selected, setSelected]     = useState<Transaction | null>(null)

  const filterRef = useRef(filter)
  filterRef.current = filter

  const groups = useMemo(() => groupByDate(transactions), [transactions])

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const load = useCallback(async (f: Filter, p: number, append: boolean) => {
    if (!token) return
    if (!append) setLoading(true)
    else         setLoadingMore(true)
    setError(null)
    try {
      const result = await fetchAtividade(token, f, p, PAGE_SIZE)
      setTx(prev => append ? [...prev, ...result.data] : result.data)
      setPage(p)
      setHasMore(result.hasMore)
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar atividade')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [token])

  // Carga inicial
  useEffect(() => {
    load('all', 0, false)
  }, [load])

  // Trocar filtro → resetar
  const handleFilter = useCallback((f: Filter) => {
    setFilter(f)
    setTx([])
    setPage(0)
    setHasMore(false)
    load(f, 0, false)
  }, [load])

  // Pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await load(filterRef.current, 0, false)
    setRefreshing(false)
  }, [load])

  // Scroll infinito
  const handleEndReached = useCallback(() => {
    if (!hasMore || loadingMore || loading) return
    load(filterRef.current, page + 1, true)
  }, [hasMore, loadingMore, loading, page, load])

  // ── Filtros ──────────────────────────────────────────────────────────────

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',    label: t('atividade.filterAll') },
    { key: 'in',     label: t('atividade.filterIn') },
    { key: 'out',    label: t('atividade.filterOut') },
    { key: 'split',  label: t('atividade.filterSplits') },
    { key: 'ticket', label: t('atividade.filterTickets') },
  ]

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header variant="title" title={t('atividade.title')} />

      {/* Balance row */}
      <View style={styles.balanceRow}>
        <BalanceStat label={t('atividade.available')} value={balance} />
        <View style={styles.balanceDivider} />
        <BalanceStat label={t('atividade.reserved')} value={reserved} muted />
      </View>

      {/* Saldo bloqueado em splits */}
      {reserved > 0 && (
        <TouchableOpacity
          onPress={() => router.push('/(app)/split/')}
          style={styles.reservedBanner}
          activeOpacity={0.8}
        >
          <Text style={styles.reservedBannerText}>
            🔒 {t('atividade.reservedBanner', { n: reserved, count: 1 })}
          </Text>
          <Text style={styles.reservedBannerCta}>{t('atividade.reservedBannerCta')} ›</Text>
        </TouchableOpacity>
      )}

      {/* Filtros */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersContent}
        style={styles.filters}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            onPress={() => handleFilter(f.key)}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Erro */}
      {error && !loading && (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Lista */}
      <FlatList
        data={groups}
        keyExtractor={g => g.date}
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 80, 100) }}
        showsVerticalScrollIndicator={false}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="rgba(255,255,255,0.3)"
          />
        }
        renderItem={({ item: group }) => (
          <View style={styles.group}>
            <Text style={styles.groupDate}>{group.date}</Text>
            {group.items.map((tx, i) => (
              <TouchableOpacity
                key={tx.id}
                onPress={() => setSelected(tx)}
                style={[styles.txRow, i > 0 && styles.txRowBorder]}
                activeOpacity={0.7}
              >
                <View style={styles.txIcon}>
                  <Text style={styles.txIconText}>{TX_ICON[tx.type]}</Text>
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txDesc}>{tx.desc}</Text>
                  <Text style={styles.txSub}>{tx.sub}</Text>
                </View>
                <Text style={[styles.txAmount, { color: txColor(tx.type, tx.amount) }]}>
                  {txSign(tx.type, tx.amount)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        ListEmptyComponent={
          loading
            ? <SkeletonList />
            : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{t('atividade.empty')}</Text>
              </View>
            )
        }
        ListFooterComponent={
          <View>
            {loadingMore && (
              <View style={styles.loadMoreSpinner}>
                <ActivityIndicator size="small" color="rgba(255,255,255,0.3)" />
              </View>
            )}
            {!loadingMore && hasMore && (
              <TouchableOpacity
                onPress={() => load(filter, page + 1, true)}
                style={styles.loadMoreBtn}
              >
                <Text style={styles.loadMoreText}>{t('atividade.loadMore')}</Text>
              </TouchableOpacity>
            )}
            {!loading && !hasMore && transactions.length > 0 && (
              <View style={styles.asaasFooter}>
                <Text style={styles.asaasNote}>{t('atividade.asaasNote')}</Text>
                <AsaasBadge size="small" />
              </View>
            )}
          </View>
        }
      />

      {/* Detalhe modal */}
      {selected && (
        <TxDetailModal tx={selected} onClose={() => setSelected(null)} />
      )}
    </View>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <View style={skeleton.row}>
      <View style={skeleton.icon} />
      <View style={skeleton.info}>
        <View style={skeleton.line1} />
        <View style={skeleton.line2} />
      </View>
      <View style={skeleton.amount} />
    </View>
  )
}

function SkeletonList() {
  return (
    <View style={skeleton.wrap}>
      <View style={skeleton.dateBar} />
      {[0,1,2,3,4].map(i => <SkeletonRow key={i} />)}
      <View style={[skeleton.dateBar, { marginTop: 16 }]} />
      {[0,1,2].map(i => <SkeletonRow key={i} />)}
    </View>
  )
}

const skeleton = StyleSheet.create({
  wrap:    { paddingHorizontal: spacing.lg },
  dateBar: { width: 60, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: 10, marginTop: 12 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.04)' },
  icon:    { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)' },
  info:    { flex: 1, gap: 7 },
  line1:   { height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.08)', width: '65%' },
  line2:   { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.05)', width: '45%' },
  amount:  { width: 36, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.07)' },
})

// ─── Balance stat ─────────────────────────────────────────────────────────────

function BalanceStat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  const { t } = useTranslation()
  return (
    <View style={balanceStat.wrap}>
      <Text style={balanceStat.label}>{label}</Text>
      <View style={balanceStat.row}>
        <Text style={[balanceStat.value, muted && balanceStat.muted]}>{value}</Text>
        <Text style={balanceStat.unit}> {t('atividade.unit')}</Text>
      </View>
    </View>
  )
}

const balanceStat = StyleSheet.create({
  wrap:  { flex: 1 },
  label: { fontSize: 11, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.4)', letterSpacing: 11 * 0.1, textTransform: 'uppercase', marginBottom: 3 },
  row:   { flexDirection: 'row', alignItems: 'baseline' },
  value: { fontSize: 22, fontWeight: '700', fontFamily: typography.fontFamily.primary, color: colors.white[100], fontVariant: ['tabular-nums'] },
  muted: { color: colors.warning[500] },
  unit:  { fontSize: 12, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.4)' },
})

// ─── Detail modal ─────────────────────────────────────────────────────────────

function TxDetailModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const { t } = useTranslation()

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={detail.overlay} activeOpacity={1} onPress={onClose} />
      <View style={detail.sheet}>
        <View style={detail.handle} />
        <Text style={detail.title}>{t('atividade.detailTitle')}</Text>

        <View style={detail.iconRow}>
          <View style={detail.iconCircle}>
            <Text style={detail.iconText}>{TX_ICON[tx.type]}</Text>
          </View>
          <View>
            <Text style={detail.descText}>{tx.desc}</Text>
            <Text style={detail.subText}>{tx.sub}</Text>
          </View>
        </View>

        <Text style={[detail.amount, { color: txColor(tx.type, tx.amount) }]}>
          {txSign(tx.type, tx.amount)} Albers
        </Text>

        <View style={detail.rows}>
          {(tx.type === 'receber' || tx.type === 'enviar') && tx.fee ? (
            <>
              <DetailRow label={t('atividade.detailGross')} value={`${tx.gross ?? Math.abs(tx.amount)} A`} />
              <DetailRow label={t('atividade.detailFee')}   value={`−${tx.fee} A`} />
            </>
          ) : null}

          {tx.handle && (
            <DetailRow
              label={tx.amount > 0 ? t('atividade.detailFrom') : t('atividade.detailTo')}
              value={tx.handle}
            />
          )}

          {tx.splitName && (
            <DetailRow label={t('atividade.detailSplit')} value={tx.splitName} />
          )}

          {tx.eventName && (
            <>
              <DetailRow label={t('atividade.detailEvent')} value={tx.eventName} />
              {tx.eventDate && <DetailRow label={t('atividade.detailEventDate')} value={tx.eventDate} />}
            </>
          )}

          <DetailRow label={t('atividade.detailDate')}   value={formatDateTime(tx.date)} />
          <DetailRow label={t('atividade.detailId')}     value={tx.id} muted />
          <DetailRow label={t('atividade.detailStatus')} value={t('atividade.detailStatusDone')} accent={colors.state.success} />
        </View>

        {tx.splitId && (
          <TouchableOpacity
            onPress={() => { onClose(); router.push(`/(app)/split/${tx.splitId}`) }}
            style={detail.linkBtn}
          >
            <Text style={detail.linkText}>{t('atividade.detailViewSplit')} ›</Text>
          </TouchableOpacity>
        )}
        {tx.eventId && (
          <TouchableOpacity
            onPress={() => { onClose(); router.push(`/(app)/lounge/evento/${tx.eventId}`) }}
            style={detail.linkBtn}
          >
            <Text style={detail.linkText}>{t('atividade.detailViewEvent')} ›</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={onClose} style={detail.closeBtn}>
          <Text style={detail.closeText}>{t('atividade.close')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  )
}

function DetailRow({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: string }) {
  return (
    <View style={detail.detailRow}>
      <Text style={detail.detailLabel}>{label}</Text>
      <Text style={[detail.detailValue, muted && detail.detailMuted, accent ? { color: accent } : undefined]}>
        {value}
      </Text>
    </View>
  )
}

const detail = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.black[90],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing.lg, paddingBottom: 40,
    borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.1)',
  },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 18 },
  title:     { fontSize: 13, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.45)', letterSpacing: 13 * 0.1, textTransform: 'uppercase', marginBottom: 16, textAlign: 'center' },
  iconRow:   { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  iconCircle:{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  iconText:  { fontSize: 18 },
  descText:  { fontSize: 15, fontWeight: '600', fontFamily: typography.fontFamily.primary, color: colors.white[100] },
  subText:   { fontSize: 11.5, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  amount:    { fontSize: 28, fontWeight: '700', fontFamily: typography.fontFamily.primary, fontVariant: ['tabular-nums'], marginBottom: 16 },
  rows:      { gap: 0, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.06)' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)' },
  detailLabel:{ fontSize: 12, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.45)' },
  detailValue:{ fontSize: 12.5, fontFamily: typography.fontFamily.primary, color: colors.white[100], fontWeight: '500', textAlign: 'right', maxWidth: '60%' },
  detailMuted:{ color: 'rgba(255,255,255,0.3)' },
  linkBtn:   { marginTop: 14, paddingVertical: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center' },
  linkText:  { fontSize: 13, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  closeBtn:  { marginTop: 10, paddingVertical: 13, alignItems: 'center' },
  closeText: { fontSize: 13, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.45)' },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  flex: { flex: 1 },

  balanceRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  balanceDivider: {
    width: 0.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: spacing.md,
  },

  reservedBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(245,158,11,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reservedBannerText: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: colors.warning[500],
    flex: 1,
  },
  reservedBannerCta: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: colors.warning[500],
    fontWeight: '600',
    marginLeft: 8,
  },

  filters: { flexGrow: 0 },
  filtersContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterChipActive: {
    backgroundColor: colors.white[100],
    borderColor: 'transparent',
  },
  filterChipText: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
  },
  filterChipTextActive: {
    color: colors.black[100],
  },

  errorWrap: { paddingHorizontal: spacing.lg, paddingVertical: 10 },
  errorText: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
    textAlign: 'center',
  },

  group: { paddingHorizontal: spacing.lg, marginTop: 12 },
  groupDate: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.32)',
    letterSpacing: 10 * 0.16,
    paddingVertical: 10,
    textTransform: 'uppercase',
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  txRowBorder: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  txIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  txIconText: { fontSize: 13 },
  txInfo: { flex: 1 },
  txDesc:   { fontSize: 14, fontFamily: typography.fontFamily.primary, color: colors.white[100] },
  txSub:    { fontSize: 11.5, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  txAmount: { fontSize: 14.5, fontWeight: '600', fontFamily: typography.fontFamily.primary, fontVariant: ['tabular-nums'] },

  emptyState: { paddingVertical: 60, alignItems: 'center' },
  emptyText:  { fontSize: 13, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.35)' },

  loadMoreSpinner: { paddingVertical: 20, alignItems: 'center' },
  loadMoreBtn:  { paddingVertical: 16, alignItems: 'center' },
  loadMoreText: { fontSize: 12.5, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.4)' },

  asaasFooter: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  asaasNote:   { fontSize: 11, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.3)' },
})
