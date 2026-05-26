// Design: /design/flows-rest.jsx — AtividadeScreen
// Spec: /specs/06_modules/atividade.md
// Histórico de movimentações com filtros, agrupamento por data e detalhe

import { useState, useCallback, useMemo } from 'react'
import {
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
import { useBalanceStore } from '../../store/balance.store'
import { Header } from '../../components/core/Header'
import { Eyebrow } from '../../components/shared/Eyebrow'
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
  id:        string
  type:      TxType
  desc:      string
  sub:       string
  amount:    number
  date:      string    // ISO string
  handle?:   string
  splitId?:  string
  splitName?:string
  eventId?:  string
  eventName?:string
  eventDate?:string
  fee?:      number
  gross?:    number
}

type Filter = 'all' | 'in' | 'out' | 'split' | 'ticket'

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_TXN: Transaction[] = [
  { id: 't01', type: 'receber',       desc: '@joaosilva',         sub: 'Albers · taxa −2',                 amount: 120,  fee: 2,  gross: 122, handle: '@joaosilva',     date: '2026-05-26T14:30:00Z' },
  { id: 't02', type: 'split_block',   desc: 'Airbnb Trancoso',   sub: 'Reservado · split variável',        amount: -300, splitId: 'split-1', splitName: 'Airbnb Trancoso', date: '2026-05-26T10:00:00Z' },
  { id: 't03', type: 'carregar',      desc: 'Carga via Pix',     sub: 'Ana CPF correspondente',             amount: 500,  date: '2026-05-26T09:15:00Z' },
  { id: 't04', type: 'event_purchase',desc: 'Sessão de Longboard',sub: 'Surf Club · 1º Lote',              amount: -80,  eventId: 'ev-surf-1', eventName: 'Sessão de Longboard', eventDate: '14/06/2026', date: '2026-05-25T18:00:00Z' },
  { id: 't05', type: 'enviar',        desc: '@cami',             sub: 'Albers · taxa −1',                  amount: -45,  fee: 1,  gross: 44, handle: '@cami',           date: '2026-05-25T16:45:00Z' },
  { id: 't06', type: 'fee',           desc: 'Taxa de envio',     sub: 'Transação #t05',                    amount: -1,   date: '2026-05-25T16:45:01Z' },
  { id: 't07', type: 'split_release', desc: 'Jantar Sushi',      sub: 'Excedente devolvido',               amount: 30,   splitId: 'split-2', splitName: 'Jantar Sushi', date: '2026-05-24T20:00:00Z' },
  { id: 't08', type: 'split_debit',   desc: 'Jantar Sushi',      sub: 'Débito final',                      amount: -120, splitId: 'split-2', splitName: 'Jantar Sushi', date: '2026-05-24T19:58:00Z' },
  { id: 't09', type: 'descarregar',   desc: 'Pix enviado',       sub: 'Para chave (11) ****-1234',         amount: -200, date: '2026-05-23T11:00:00Z' },
  { id: 't10', type: 'receber',       desc: '@rodrigomaia',      sub: 'Albers · taxa −3',                  amount: 240,  fee: 3,  gross: 243, handle: '@rodrigomaia',   date: '2026-05-22T09:30:00Z' },
  { id: 't11', type: 'event_refund',  desc: 'Hackathon IA',      sub: 'Reembolso · cancelamento',          amount: 80,   eventId: 'ev-tech-1', eventName: 'Hackathon IA', date: '2026-05-21T14:00:00Z' },
  { id: 't12', type: 'carregar',      desc: 'Carga via Pix',     sub: 'Transferência TED',                 amount: 1000, date: '2026-05-20T08:00:00Z' },
  { id: 't13', type: 'enviar',        desc: '@beatrizcosta',     sub: 'Albers · taxa −1',                  amount: -60,  fee: 1,  gross: 59, handle: '@beatrizcosta', date: '2026-05-19T17:00:00Z' },
  { id: 't14', type: 'split_block',   desc: 'Happy Hour',        sub: 'Reservado · split fixo',            amount: -90,  splitId: 'split-3', splitName: 'Happy Hour', date: '2026-05-18T20:00:00Z' },
  { id: 't15', type: 'event_purchase',desc: 'Jantar Harmonização',sub: 'Gourmet Club · 2º Lote',           amount: -150, eventId: 'ev-gourmet-1', eventName: 'Jantar Harmonização', eventDate: '11/07/2026', date: '2026-05-17T12:00:00Z' },
  { id: 't16', type: 'receber',       desc: '@felipenunes',      sub: 'Albers · taxa −1',                  amount: 90,   fee: 1,  gross: 91, handle: '@felipenunes',   date: '2026-05-16T10:00:00Z' },
  { id: 't17', type: 'descarregar',   desc: 'Pix enviado',       sub: 'Para CPF ***.***.123-45',           amount: -350, date: '2026-05-15T15:30:00Z' },
  { id: 't18', type: 'split_debit',   desc: 'Happy Hour',        sub: 'Débito final',                      amount: -90,  splitId: 'split-3', splitName: 'Happy Hour',  date: '2026-05-14T22:00:00Z' },
  { id: 't19', type: 'fee',           desc: 'Taxa de saída',     sub: 'Descarregar',                       amount: -2,   date: '2026-05-13T11:01:00Z' },
  { id: 't20', type: 'carregar',      desc: 'Carga via Pix',     sub: 'Depósito inicial',                  amount: 300,  date: '2026-05-12T09:00:00Z' },
]

const PAGE_SIZE = 20

// ─── Filter logic ─────────────────────────────────────────────────────────────

const FILTER_TYPES: Record<Filter, TxType[]> = {
  all:    ['carregar','descarregar','receber','enviar','split_block','split_release','split_debit','event_purchase','event_refund','fee'],
  in:     ['carregar','receber','split_release','event_refund'],
  out:    ['descarregar','enviar','split_debit','event_purchase','fee'],
  split:  ['split_block','split_release','split_debit'],
  ticket: ['event_purchase','event_refund'],
}

// ─── Icons (text-based) ────────────────────────────────────────────────────────

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
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const txDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff  = today.getTime() - txDay.getTime()
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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AtividadeScreen() {
  const { t }  = useTranslation()
  const insets = useSafeAreaInsets()

  const balance  = useBalanceStore(s => s.balance)
  const reserved = 300

  const [filter, setFilter]       = useState<Filter>('all')
  const [page, setPage]           = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected]   = useState<Transaction | null>(null)

  const filtered = useMemo(() => {
    const allowed = FILTER_TYPES[filter]
    return MOCK_TXN.filter(tx => allowed.includes(tx.type))
  }, [filter])

  const visible  = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page])
  const groups   = useMemo(() => groupByDate(visible), [visible])
  const hasMore  = visible.length < filtered.length

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 600)
  }, [])

  // ── Filters ─────────────────────────────────────────────────────────────────

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',    label: t('atividade.filterAll') },
    { key: 'in',     label: t('atividade.filterIn') },
    { key: 'out',    label: t('atividade.filterOut') },
    { key: 'split',  label: t('atividade.filterSplits') },
    { key: 'ticket', label: t('atividade.filterTickets') },
  ]

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header variant="title" title={t('atividade.title')} />

      {/* Balance row */}
      <View style={styles.balanceRow}>
        <BalanceStat label={t('atividade.available')} value={balance} />
        <View style={styles.balanceDivider} />
        <BalanceStat label={t('atividade.reserved')} value={reserved} muted />
      </View>

      {/* Reserved banner */}
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

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersContent}
        style={styles.filters}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            onPress={() => { setFilter(f.key); setPage(1) }}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Transaction list */}
      <FlatList
        data={groups}
        keyExtractor={g => g.date}
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 80, 100) }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="rgba(255,255,255,0.3)" />
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
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('atividade.empty')}</Text>
          </View>
        }
        ListFooterComponent={
          hasMore ? (
            <TouchableOpacity onPress={() => setPage(p => p + 1)} style={styles.loadMoreBtn}>
              <Text style={styles.loadMoreText}>{t('atividade.loadMore')}</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      {/* Detail modal */}
      {selected && (
        <TxDetailModal
          tx={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </View>
  )
}

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

        {/* Type icon + desc */}
        <View style={detail.iconRow}>
          <View style={detail.iconCircle}>
            <Text style={detail.iconText}>{TX_ICON[tx.type]}</Text>
          </View>
          <View>
            <Text style={detail.descText}>{tx.desc}</Text>
            <Text style={detail.subText}>{tx.sub}</Text>
          </View>
        </View>

        {/* Amount */}
        <Text style={[detail.amount, { color: txColor(tx.type, tx.amount) }]}>
          {txSign(tx.type, tx.amount)} Albers
        </Text>

        <View style={detail.rows}>
          {/* Receber / Enviar */}
          {(tx.type === 'receber' || tx.type === 'enviar') && tx.fee && (
            <>
              <DetailRow label={t('atividade.detailGross')} value={`${tx.gross ?? tx.amount} A`} />
              <DetailRow label={t('atividade.detailFee')} value={`−${tx.fee} A`} />
            </>
          )}
          {tx.handle && (
            <DetailRow
              label={tx.amount > 0 ? t('atividade.detailFrom') : t('atividade.detailTo')}
              value={tx.handle}
            />
          )}

          {/* Split */}
          {tx.splitName && (
            <DetailRow label={t('atividade.detailSplit')} value={tx.splitName} />
          )}

          {/* Event */}
          {tx.eventName && (
            <>
              <DetailRow label={t('atividade.detailEvent')} value={tx.eventName} />
              {tx.eventDate && <DetailRow label={t('atividade.detailEventDate')} value={tx.eventDate} />}
            </>
          )}

          <DetailRow label={t('atividade.detailDate')} value={formatDateTime(tx.date)} />
          <DetailRow label={t('atividade.detailId')} value={tx.id} muted />
          <DetailRow label={t('atividade.detailStatus')} value={t('atividade.detailStatusDone')} accent={colors.state.success} />
        </View>

        {/* Links */}
        {tx.splitId && (
          <TouchableOpacity
            onPress={onClose}
            style={detail.linkBtn}
          >
            <Text style={detail.linkText}>{t('atividade.detailViewSplit')} ›</Text>
          </TouchableOpacity>
        )}
        {tx.eventId && (
          <TouchableOpacity
            onPress={onClose}
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
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 18 },
  title: { fontSize: 13, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.45)', letterSpacing: 13 * 0.1, textTransform: 'uppercase', marginBottom: 16, textAlign: 'center' },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 18 },
  descText: { fontSize: 15, fontWeight: '600', fontFamily: typography.fontFamily.primary, color: colors.white[100] },
  subText: { fontSize: 11.5, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  amount: { fontSize: 28, fontWeight: '700', fontFamily: typography.fontFamily.primary, fontVariant: ['tabular-nums'], marginBottom: 16 },
  rows: { gap: 0, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.06)' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)' },
  detailLabel: { fontSize: 12, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.45)' },
  detailValue: { fontSize: 12.5, fontFamily: typography.fontFamily.primary, color: colors.white[100], fontWeight: '500', textAlign: 'right', maxWidth: '60%' },
  detailMuted: { color: 'rgba(255,255,255,0.3)' },
  linkBtn: { marginTop: 14, paddingVertical: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center' },
  linkText: { fontSize: 13, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  closeBtn: { marginTop: 10, paddingVertical: 13, alignItems: 'center' },
  closeText: { fontSize: 13, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.45)' },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100] },
  flex: { flex: 1 },

  // Balance
  balanceRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    gap: 0,
  },
  balanceDivider: {
    width: 0.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: spacing.md,
  },

  // Reserved banner
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

  // Filters
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

  // Groups
  group: { paddingHorizontal: spacing.lg, marginTop: 12 },
  groupDate: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.32)',
    letterSpacing: 10 * 0.16,
    paddingVertical: 10,
    textTransform: 'uppercase',
  },

  // Rows
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
  txDesc: { fontSize: 14, fontFamily: typography.fontFamily.primary, color: colors.white[100] },
  txSub: { fontSize: 11.5, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  txAmount: { fontSize: 14.5, fontWeight: '600', fontFamily: typography.fontFamily.primary, fontVariant: ['tabular-nums'] },

  // States
  emptyState: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { fontSize: 13, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.35)' },
  loadMoreBtn: { paddingVertical: 16, alignItems: 'center' },
  loadMoreText: { fontSize: 12.5, fontFamily: typography.fontFamily.primary, color: 'rgba(255,255,255,0.4)' },
})
