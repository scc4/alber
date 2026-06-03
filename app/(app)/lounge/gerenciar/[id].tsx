// Design: /design/flows-rest.jsx — SpaceCustomizeScreen + EventManageScreen
// Spec: /specs/06_modules/alber_lounge.md § 7 "Painel de gestão"
// Tabs: Visão geral | Membros | Mensagens | Visual

import { useState } from 'react'
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useLoungeStore } from '../../../../store/lounge.store'
import type { LoungeMember, LoungeRequest } from '../../../../store/lounge.store'
import { useAuthStore } from '../../../../store/auth.store'
import { pickFromGallery, uploadImage } from '../../../../services/storage.service'
import { Header } from '../../../../components/core/Header'
import { Eyebrow } from '../../../../components/shared/Eyebrow'
import { PrimaryButton } from '../../../../components/core/PrimaryButton'
import { EventCard } from '../../../../components/lounge/EventCard'
import { colors } from '../../../../tokens/colors'
import { spacing } from '../../../../tokens/spacing'
import { typography } from '../../../../tokens/typography'

// ─── Constants ────────────────────────────────────────────────────────────────

const PALETTE = ['#5BCEC9', '#C9B06A', '#E07D7D', '#7DA3E0', '#B58FE0', '#7AB87A', '#E0B05B', '#9B6B82']
type Tab = 'overview' | 'members' | 'messages' | 'visual'

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GerenciarScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>()
  const { t }   = useTranslation()
  const insets  = useSafeAreaInsets()

  const getLoungeById  = useLoungeStore(s => s.getLoungeById)
  const approveRequest = useLoungeStore(s => s.approveRequest)
  const rejectRequest  = useLoungeStore(s => s.rejectRequest)
  const promoteMember  = useLoungeStore(s => s.promoteMember)
  const removeMember   = useLoungeStore(s => s.removeMember)
  const sendMessage    = useLoungeStore(s => s.sendMessage)
  const updateVisual   = useLoungeStore(s => s.updateVisual)
  const generateInvite = useLoungeStore(s => s.generateInvite)
  const cancelEvent    = useLoungeStore(s => s.cancelEvent)

  const lounge = getLoungeById(id)

  const token     = useAuthStore(s => s.token)

  const [tab, setTab]         = useState<Tab>('overview')
  const [msgText, setMsgText] = useState('')
  const [accent, setAccent]   = useState(lounge?.accent ?? PALETTE[0])
  const [bgImageUri, setBgImageUri] = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(
    lounge?.inviteToken ? `alber://lounge/${id}/convite/${lounge.inviteToken}` : null
  )

  // ── Not found / unauthorised ──────────────────────────────────────────────────

  if (!lounge || (lounge.role !== 'owner' && lounge.role !== 'manager')) {
    return (
      <View style={styles.root}>
        <Header variant="title" title={t('lounge.gerenciar.title')} onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Sem permissão para gerenciar este Lounge.</Text>
        </View>
      </View>
    )
  }

  const isOwner = lounge.role === 'owner'

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleApprove(req: LoungeRequest) {
    if (!lounge) return
    approveRequest(lounge.id, req.id)
  }

  function handleReject(req: LoungeRequest) {
    if (!lounge) return
    rejectRequest(lounge.id, req.id)
  }

  function handlePromote(member: LoungeMember) {
    if (!lounge) return
    promoteMember(lounge.id, member.id)
  }

  function handleRemove(member: LoungeMember) {
    if (!lounge) return
    removeMember(lounge.id, member.id)
  }

  function handleSendMessage() {
    if (!lounge || !msgText.trim()) return
    sendMessage(lounge.id, msgText.trim())
    setMsgText('')
  }

  async function handleSaveVisual() {
    if (!lounge || !token) return
    setSaving(true)
    try {
      const uploadedUrl = bgImageUri
        ? await uploadImage(bgImageUri, 'lounge-images', `${lounge.id}/bg/${Date.now()}`, token)
        : null
      updateVisual(lounge.id, accent, uploadedUrl)
      router.back()
    } finally {
      setSaving(false)
    }
  }

  function handleGenerateInvite() {
    if (!lounge) return
    const token = generateInvite(lounge.id)
    setInviteUrl(`alber://lounge/${lounge.id}/convite/${token}`)
  }

  function handleCancelEvent(eventId: string, eventName: string) {
    if (!lounge) return
    Alert.alert(
      t('lounge.gerenciar.cancelConfirmTitle'),
      t('lounge.gerenciar.cancelConfirmBody', { n: lounge.events.find(e => e.id === eventId)?.confirmed ?? 0 }),
      [
        { text: t('lounge.gerenciar.cancelBack'), style: 'cancel' },
        {
          text: t('lounge.gerenciar.cancelConfirmCta'),
          style: 'destructive',
          onPress: () => cancelEvent(eventId),
        },
      ]
    )
  }

  // ── Tab bar ──────────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview',  label: t('lounge.gerenciar.tabOverview') },
    { key: 'members',   label: t('lounge.gerenciar.tabMembers') },
    { key: 'messages',  label: t('lounge.gerenciar.tabMessages') },
    { key: 'visual',    label: t('lounge.gerenciar.tabVisual') },
  ]

  return (
    <View style={styles.root}>
      <Header
        variant="title"
        title={t('lounge.gerenciar.title')}
        contextLabel={lounge.name}
        onBack={() => router.back()}
      />

      {/* Tab switcher */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabScrollContent}
        style={styles.tabScroll}
      >
        {TABS.map(tb => (
          <TouchableOpacity
            key={tb.key}
            onPress={() => setTab(tb.key)}
            style={[styles.tabBtn, tab === tb.key && { borderBottomColor: lounge.accent }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === tb.key }}
          >
            <Text style={[styles.tabLabel, tab === tb.key && { color: lounge.accent }]}>
              {tb.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Overview ────────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, spacing.xl) }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Settings */}
          <Eyebrow>{t('lounge.gerenciar.settingsSection')}</Eyebrow>
          <View style={styles.settingsCard}>
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>{t('lounge.gerenciar.visibilityLabel')}</Text>
              <View style={styles.visToggle}>
                {(['public', 'private'] as const).map(v => (
                  <View
                    key={v}
                    style={[styles.visChip, lounge.visibility === v && { backgroundColor: `${lounge.accent}22`, borderColor: `${lounge.accent}55` }]}
                  >
                    <Text style={[styles.visChipText, lounge.visibility === v && { color: lounge.accent }]}>
                      {v === 'public' ? t('lounge.visPublic') : t('lounge.visPrivate')}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Invite */}
          <View style={styles.sectionGap}>
            <Eyebrow>{t('lounge.gerenciar.inviteSection')}</Eyebrow>
          </View>
          {inviteUrl ? (
            <View style={styles.inviteCard}>
              <Text style={styles.inviteUrl} numberOfLines={1}>{inviteUrl}</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={handleGenerateInvite}
              style={[styles.generateLinkBtn, { borderColor: `${lounge.accent}55` }]}
              activeOpacity={0.8}
            >
              <Text style={[styles.generateLinkText, { color: lounge.accent }]}>
                {t('lounge.gerenciar.generateLinkCta')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Events */}
          <View style={styles.sectionGap}>
            <View style={styles.rowBetween}>
              <Eyebrow>{t('lounge.eventsSection')}</Eyebrow>
              <TouchableOpacity onPress={() => router.push(`/(app)/lounge/criar-evento/${lounge.id}`)}>
                <Text style={[styles.createEventLink, { color: lounge.accent }]}>{t('lounge.createEventCta')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {lounge.events.length === 0 ? (
            <Text style={styles.emptyText}>{t('lounge.noEvents')}</Text>
          ) : (
            <View style={styles.eventList}>
              {lounge.events.map(event => (
                <View key={event.id}>
                  <EventCard
                    event={event}
                    accent={lounge.accent}
                    isManager
                    onPress={() => router.push(`/(app)/lounge/evento/${event.id}`)}
                  />
                  {event.status === 'active' && isOwner && (
                    <View style={styles.eventActions}>
                      <TouchableOpacity
                        onPress={() => handleCancelEvent(event.id, event.name)}
                        style={styles.eventActionBtn}
                      >
                        <Text style={styles.cancelEventText}>{t('lounge.gerenciar.cancelEventCta')}</Text>
                        <Text style={styles.cancelEventSub}>{t('lounge.gerenciar.cancelEventSub')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Members ─────────────────────────────────────────────────────────── */}
      {tab === 'members' && (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, spacing.xl) }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Pending */}
          <Eyebrow>{t('lounge.gerenciar.pendingSection')}</Eyebrow>
          {lounge.pendingRequests.length === 0 ? (
            <Text style={styles.emptyText}>{t('lounge.gerenciar.noPending')}</Text>
          ) : (
            <View style={styles.memberList}>
              {lounge.pendingRequests.map((req, i) => (
                <View key={req.id} style={[styles.memberRow, i > 0 && styles.memberRowBorder]}>
                  <View style={[styles.avatar, { backgroundColor: avatarHue(req.handle) }]}>
                    <Text style={styles.avatarText}>{req.initials[0]}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{req.name}</Text>
                    <Text style={styles.memberHandle}>{req.handle}</Text>
                  </View>
                  <View style={styles.requestActions}>
                    <TouchableOpacity
                      onPress={() => handleApprove(req)}
                      style={[styles.approveBtn, { borderColor: `${lounge.accent}55` }]}
                    >
                      <Text style={[styles.approveBtnText, { color: lounge.accent }]}>
                        {t('lounge.gerenciar.approveCta')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleReject(req)} style={styles.rejectBtn}>
                      <Text style={styles.rejectBtnText}>{t('lounge.gerenciar.rejectCta')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Members list */}
          <View style={styles.sectionGap}>
            <Eyebrow>{t('lounge.gerenciar.membersSection')}</Eyebrow>
          </View>
          <View style={styles.memberList}>
            {lounge.members.map((member, i) => {
              const isMe = member.id === 'user-self'
              const canManage = !isMe && member.role !== 'owner'
              return (
                <View key={member.id} style={[styles.memberRow, i > 0 && styles.memberRowBorder]}>
                  <View style={[styles.avatar, { backgroundColor: avatarHue(member.handle) }]}>
                    <Text style={styles.avatarText}>{member.initials[0]}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberHandle}>{member.handle}</Text>
                  </View>
                  <View style={styles.memberRoleWrap}>
                    <Text style={[styles.memberRole, member.role === 'owner' && { color: lounge.accent }]}>
                      {member.role === 'owner'
                        ? t('lounge.roleOwner')
                        : member.role === 'manager'
                        ? t('lounge.roleManager')
                        : t('lounge.roleMember')}
                    </Text>
                    {canManage && isOwner && (
                      <TouchableOpacity onPress={() => handlePromote(member)}>
                        <Text style={[styles.promoteText, { color: lounge.accent }]}>
                          {member.role === 'member' ? t('lounge.gerenciar.promoteToManager') : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {canManage && (
                      <TouchableOpacity onPress={() => handleRemove(member)}>
                        <Text style={styles.removeText}>{t('lounge.gerenciar.removeFromLounge')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )
            })}
          </View>
        </ScrollView>
      )}

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      {tab === 'messages' && (
        <View style={styles.flex}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: spacing.xl }]}
            showsVerticalScrollIndicator={false}
          >
            <TextInput
              style={styles.msgInput}
              value={msgText}
              onChangeText={setMsgText}
              placeholder={t('lounge.gerenciar.msgPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.3)"
              multiline
              textAlignVertical="top"
            />

            {lounge.messages.length > 0 && (
              <>
                <View style={styles.sectionGap}>
                  <Eyebrow>{t('lounge.messagesSection')}</Eyebrow>
                </View>
                {lounge.messages.map((msg, i) => (
                  <View key={msg.id} style={[styles.msgHistoryItem, i > 0 && styles.msgHistoryBorder]}>
                    <Text style={[styles.msgHistoryMeta, { color: `${lounge.accent}99` }]}>
                      {msg.authorName} · {msg.role === 'owner' ? t('lounge.roleOwner') : t('lounge.roleManager')}
                    </Text>
                    <Text style={styles.msgHistoryContent}>{msg.content}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <PrimaryButton
              label={t('lounge.gerenciar.sendCta')}
              onPress={handleSendMessage}
              state={msgText.trim().length === 0 ? 'disabled' : 'default'}
            />
          </View>
        </View>
      )}

      {/* ── Visual ──────────────────────────────────────────────────────────── */}
      {tab === 'visual' && (
        <View style={styles.flex}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + 80 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* Preview */}
            <Eyebrow>{t('lounge.criar.previewLabel')}</Eyebrow>
            <View style={[styles.previewCard, { backgroundColor: `${accent}08`, borderColor: `${accent}28` }]}>
              <View style={[styles.previewGlow, { backgroundColor: `${accent}20` }]} pointerEvents="none" />
              <View style={styles.previewContent}>
                <Text style={styles.previewHint}>SEU LOUNGE ATUAL</Text>
                <Text style={styles.previewName}>{lounge.name}</Text>
              </View>
            </View>

            {/* Accent color */}
            <View style={styles.sectionGap}>
              <Eyebrow>{t('lounge.gerenciar.customizeSection')}</Eyebrow>
            </View>
            <View style={styles.palette}>
              {PALETTE.map(c => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setAccent(c)}
                  activeOpacity={0.8}
                  style={[styles.swatch, { backgroundColor: c }, accent === c && styles.swatchSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: accent === c }}
                />
              ))}
            </View>

            {/* BG image */}
            <View style={styles.sectionGap}>
              <Eyebrow>{t('lounge.gerenciar.bgLabel')}</Eyebrow>
            </View>
            <TouchableOpacity
              style={styles.bgUpload}
              activeOpacity={0.7}
              onPress={async () => {
                const uri = await pickFromGallery()
                if (uri) setBgImageUri(uri)
              }}
            >
              {bgImageUri ? (
                <Image source={{ uri: bgImageUri }} style={styles.bgPreview} resizeMode="cover" />
              ) : (
                <>
                  <Text style={styles.bgUploadTitle}>{t('lounge.gerenciar.bgUploadCta')}</Text>
                  <Text style={styles.bgUploadHint}>{t('lounge.gerenciar.bgHint')}</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Contrast note */}
            <View style={styles.contrastNote}>
              <Text style={styles.contrastText}>{t('lounge.gerenciar.contrastOk')}</Text>
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <PrimaryButton
              label={t('lounge.gerenciar.saveCta')}
              onPress={handleSaveVisual}
              state={saving ? 'loading' : 'default'}
            />
          </View>
        </View>
      )}
    </View>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarHue(handle: string): string {
  const h = ((handle.charCodeAt(1) ?? 65) * 23) % 360
  return `hsl(${h}, 18%, 22%)`
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[100],
  },
  flex: { flex: 1 },

  // Tabs
  tabScroll: {
    flexGrow: 0,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tabScrollContent: {
    paddingHorizontal: spacing.lg,
    gap: 4,
  },
  tabBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.45)',
  },

  // Content
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sectionGap: { marginTop: 24 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // Overview – settings
  settingsCard: {
    marginTop: 10,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingsLabel: {
    fontSize: 12,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 12 * 0.08,
  },
  visToggle: {
    flexDirection: 'row',
    gap: 6,
  },
  visChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  visChipText: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 9 * 0.1,
    textTransform: 'uppercase',
  },

  // Invite
  inviteCard: {
    marginTop: 10,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
  },
  inviteUrl: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.6)',
  },
  generateLinkBtn: {
    marginTop: 10,
    paddingVertical: 11,
    borderWidth: 0.5,
    borderRadius: 10,
    alignItems: 'center',
  },
  generateLinkText: {
    fontSize: 12.5,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
  },

  // Events
  createEventLink: {
    fontSize: 11.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 11.5 * 0.04,
  },
  eventList: { gap: 8, marginTop: 10 },
  emptyText: {
    marginTop: 12,
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  eventActions: {
    marginTop: 4,
    marginBottom: 4,
  },
  eventActionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  cancelEventText: {
    fontSize: 11.5,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.state.error,
  },
  cancelEventSub: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(239,68,68,0.6)',
    marginTop: 2,
  },

  // Members
  memberList: {
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  memberRowBorder: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  memberInfo: { flex: 1 },
  memberName: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  memberHandle: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 1,
  },
  memberRoleWrap: { alignItems: 'flex-end', gap: 3 },
  memberRole: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 9 * 0.1,
    textTransform: 'uppercase',
  },
  promoteText: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
  },
  removeText: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(239,68,68,0.7)',
  },

  // Request actions
  requestActions: { flexDirection: 'row', gap: 6 },
  approveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 0.5,
  },
  approveBtnText: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
  },
  rejectBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  rejectBtnText: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.5)',
  },

  // Messages
  msgInput: {
    minHeight: 120,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    fontSize: 14,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    lineHeight: 21,
  },
  msgHistoryItem: {
    paddingVertical: 12,
    gap: 5,
  },
  msgHistoryBorder: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  msgHistoryMeta: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    fontWeight: '600',
    letterSpacing: 10.5 * 0.06,
  },
  msgHistoryContent: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 20,
  },

  // Visual
  previewCard: {
    marginTop: 12,
    height: 140,
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'flex-end',
  },
  previewGlow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  previewContent: { padding: 16 },
  previewHint: {
    fontSize: 9,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 9 * 0.14,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  previewName: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    letterSpacing: -20 * 0.02,
  },
  palette: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  swatchSelected: {
    borderColor: colors.white[100],
    transform: [{ scale: 1.1 }],
  },
  bgUpload: {
    marginTop: 12,
    padding: 24,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    alignItems: 'center',
  },
  bgUploadTitle: {
    fontSize: 13,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
  },
  bgUploadHint: {
    fontSize: 11,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.32)',
    marginTop: 4,
  },
  bgPreview: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  contrastNote: {
    marginTop: 14,
    padding: 12,
    backgroundColor: 'rgba(91,206,201,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(91,206,201,0.18)',
    borderRadius: 10,
  },
  contrastText: {
    fontSize: 11.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(91,206,201,0.85)',
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.black[100],
  },

  // Error state
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
})
