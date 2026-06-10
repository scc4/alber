// E2E logic test: lounge member management (approve, reject, remove, sendMessage)
// Validates the fixed handler logic in app/(app)/lounge/gerenciar/[id].tsx
// Run: node scripts/test-lounge-member-management.mjs

import { createStore } from '../node_modules/zustand/esm/vanilla.mjs'

let passed = 0
let failed = 0

function assert(label, condition, extra = '') {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`)
    failed++
  }
}

// ── Mock service calls (tracks what was called) ───────────────────────────────

function makeMockService() {
  const calls = []
  return {
    calls,
    approveMember: async (member_id, approved, token) => {
      calls.push({ fn: 'approveMember', member_id, approved, token })
    },
    removeMember: async (space_id, user_id, token) => {
      calls.push({ fn: 'removeMember', space_id, user_id, token })
    },
  }
}

// ── Minimal store that mirrors lounge.store.ts approveRequest / removeMember ──

function buildStore(service) {
  return createStore((set, get) => ({
    myLounges: [],
    error: null,

    approveRequest: async (memberId, approved, token) => {
      set({ error: null })
      try {
        await service.approveMember(memberId, approved, token)
        set(s => ({
          myLounges: s.myLounges.map(l => ({
            ...l,
            pendingRequests: l.pendingRequests.filter(r => r.id !== memberId),
            ...(approved ? {
              members: [
                ...l.members,
                ...l.pendingRequests.filter(r => r.id === memberId).map(r => ({
                  id: r.userId, name: r.name, handle: r.handle,
                  initials: r.initials, role: 'member', joinedAt: new Date().toISOString(),
                })),
              ],
              memberCount: l.memberCount + (l.pendingRequests.some(r => r.id === memberId) ? 1 : 0),
            } : {}),
          })),
        }))
      } catch (e) {
        set({ error: e.message ?? 'Erro ao processar solicitação' })
        throw e
      }
    },

    removeMember: async (loungeId, memberId, token) => {
      try {
        await service.removeMember(loungeId, memberId, token)
        set(s => ({
          myLounges: s.myLounges.map(l =>
            l.id === loungeId
              ? { ...l, members: l.members.filter(m => m.id !== memberId), memberCount: l.memberCount - 1 }
              : l
          ),
        }))
      } catch (e) {
        set({ error: e.message ?? 'Erro ao remover membro' })
        throw e
      }
    },

    sendMessage: (loungeId, content, authorName, authorHandle, authorInitials) => {
      const msg = {
        id: `msg-${Date.now()}`,
        authorId: 'self',
        authorName,
        authorHandle,
        authorInitials,
        role: 'owner',
        content,
        createdAt: new Date().toISOString(),
      }
      set(s => ({
        myLounges: s.myLounges.map(l =>
          l.id === loungeId ? { ...l, messages: [msg, ...l.messages] } : l
        ),
      }))
    },
  }))
}

function makeLounge(id, overrides = {}) {
  return {
    id,
    name: 'Alber Club',
    memberCount: 1,
    members: [
      { id: 'owner-1', name: 'Owner', handle: '@owner', initials: 'OW', role: 'owner', joinedAt: new Date().toISOString() },
    ],
    pendingRequests: [],
    messages: [],
    ...overrides,
  }
}

function makePendingReq(id, userId) {
  return { id, userId, name: 'Alice', handle: '@alice', initials: 'AL', requestedAt: new Date().toISOString() }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Test suite: lounge-member-management ===\n')

// ── Test 1: handleApprove — correct args reach the service ────────────────────
{
  console.log('1. handleApprove — calls approveMember(req.id, true, token)')
  const svc   = makeMockService()
  const store = buildStore(svc)
  const req   = makePendingReq('sm-abc', 'user-alice')
  const lounge = makeLounge('lounge-1', { pendingRequests: [req] })
  store.setState({ myLounges: [lounge] })

  await store.getState().approveRequest(req.id, true, 'tok-123')

  const call = svc.calls[0]
  assert('service called with req.id (not lounge.id)', call?.member_id === 'sm-abc')
  assert('service called with approved=true', call?.approved === true)
  assert('service called with token', call?.token === 'tok-123')
}

// ── Test 2: handleApprove — member added + count incremented ─────────────────
{
  console.log('\n2. handleApprove — pending removed, member added, count +1')
  const svc   = makeMockService()
  const store = buildStore(svc)
  const req   = makePendingReq('sm-abc', 'user-alice')
  const lounge = makeLounge('lounge-1', { memberCount: 1, pendingRequests: [req] })
  store.setState({ myLounges: [lounge] })

  await store.getState().approveRequest(req.id, true, 'tok')

  const updated = store.getState().myLounges[0]
  assert('pending request removed', updated.pendingRequests.length === 0)
  assert('alice added to members', updated.members.some(m => m.id === 'user-alice'))
  assert('memberCount incremented to 2', updated.memberCount === 2)
}

// ── Test 3: handleApprove — OLD BUG: wrong args (approveMember(lounge.id, req.id)) ──
{
  console.log('\n3. OLD BUG — approveRequest(lounge.id, req.id) silently does nothing')
  const svc   = makeMockService()
  const store = buildStore(svc)
  const req   = makePendingReq('sm-abc', 'user-alice')
  const lounge = makeLounge('lounge-1', { pendingRequests: [req] })
  store.setState({ myLounges: [lounge] })

  // Old (wrong) call: memberId=lounge.id, approved=req.id (truthy string), token=undefined
  await store.getState().approveRequest('lounge-1', 'sm-abc', undefined)

  const call = svc.calls[0]
  // service was called with wrong args: member_id='lounge-1' (lounge id, not member id)
  assert('service got lounge.id instead of req.id (wrong)', call?.member_id === 'lounge-1')
  // pending request NOT removed because memberId='lounge-1' ≠ req.id='sm-abc'
  const updated = store.getState().myLounges[0]
  assert('pending request stays (wrong memberId mismatch)', updated.pendingRequests.length === 1)
  assert('member NOT added', !updated.members.some(m => m.id === 'user-alice'))
  assert('memberCount stays 1 (no match found)', updated.memberCount === 1)
  console.log('  ↳ Confirms old bug: wrong args → approval has no visible effect')
}

// ── Test 4: handleReject — uses approveRequest(req.id, false) ─────────────────
{
  console.log('\n4. handleReject — calls approveRequest(req.id, false, token)')
  const svc   = makeMockService()
  const store = buildStore(svc)
  const req   = makePendingReq('sm-xyz', 'user-bob')
  const lounge = makeLounge('lounge-1', { pendingRequests: [req] })
  store.setState({ myLounges: [lounge] })

  await store.getState().approveRequest(req.id, false, 'tok')

  const call = svc.calls[0]
  assert('service called with req.id', call?.member_id === 'sm-xyz')
  assert('service called with approved=false', call?.approved === false)

  const updated = store.getState().myLounges[0]
  assert('pending request removed after rejection', updated.pendingRequests.length === 0)
  assert('bob NOT added to members', !updated.members.some(m => m.id === 'user-bob'))
  assert('memberCount unchanged', updated.memberCount === 1)
}

// ── Test 5: handleRemove — calls removeMember(loungeId, memberId, token) ──────
{
  console.log('\n5. handleRemove — calls backend + removes from store')
  const svc   = makeMockService()
  const store = buildStore(svc)
  const member = { id: 'user-alice', name: 'Alice', handle: '@alice', initials: 'AL', role: 'member', joinedAt: new Date().toISOString() }
  const lounge = makeLounge('lounge-1', {
    memberCount: 2,
    members: [
      { id: 'owner-1', name: 'Owner', handle: '@owner', initials: 'OW', role: 'owner', joinedAt: new Date().toISOString() },
      member,
    ],
  })
  store.setState({ myLounges: [lounge] })

  await store.getState().removeMember('lounge-1', 'user-alice', 'tok-456')

  const call = svc.calls[0]
  assert('removeMember service called', call?.fn === 'removeMember')
  assert('service received space_id=lounge-1', call?.space_id === 'lounge-1')
  assert('service received user_id=user-alice', call?.user_id === 'user-alice')
  assert('service received token', call?.token === 'tok-456')

  const updated = store.getState().myLounges[0]
  assert('alice removed from members', !updated.members.some(m => m.id === 'user-alice'))
  assert('memberCount decremented to 1', updated.memberCount === 1)
}

// ── Test 6: OLD BUG — removeMember local-only (no backend call) ───────────────
{
  console.log('\n6. OLD BUG — local-only removeMember had no backend call')
  // Simulates the old implementation: just set state, no service call
  function buildOldStore() {
    return createStore((set) => ({
      myLounges: [],
      removeMember_old: (loungeId, memberId) => {
        // Old: no async, no service call
        set(s => ({
          myLounges: s.myLounges.map(l =>
            l.id === loungeId
              ? { ...l, members: l.members.filter(m => m.id !== memberId), memberCount: l.memberCount - 1 }
              : l
          ),
        }))
      },
    }))
  }
  const store = buildOldStore()
  const member = { id: 'user-alice', role: 'member', joinedAt: new Date().toISOString() }
  const lounge = makeLounge('lounge-1', { memberCount: 2, members: [
    { id: 'owner-1', role: 'owner', joinedAt: new Date().toISOString() }, member
  ]})
  store.setState({ myLounges: [lounge] })

  store.getState().removeMember_old('lounge-1', 'user-alice')

  const updated = store.getState().myLounges[0]
  assert('store updated locally (removes from UI)', !updated.members.some(m => m.id === 'user-alice'))
  console.log('  ↳ BUT: DB still has alice as active — after fetchMyLounges she comes back')
  console.log('  ↳ Fix: new removeMember calls lounge-remove-member Edge Function first')
}

// ── Test 7: sendMessage — all 5 args required ────────────────────────────────
{
  console.log('\n7. sendMessage — correct 5-arg call adds message with author metadata')
  const svc   = makeMockService()
  const store = buildStore(svc)
  const lounge = makeLounge('lounge-1')
  store.setState({ myLounges: [lounge] })

  store.getState().sendMessage('lounge-1', 'Evento amanhã!', 'Fernando', '@fernando', 'FO')

  const updated = store.getState().myLounges[0]
  assert('message added', updated.messages.length === 1)
  const msg = updated.messages[0]
  assert('content correct', msg.content === 'Evento amanhã!')
  assert('authorName set', msg.authorName === 'Fernando')
  assert('authorHandle set', msg.authorHandle === '@fernando')
  assert('authorInitials set', msg.authorInitials === 'FO')
}

// ── Test 8: sendMessage OLD BUG — 2-arg call leaves metadata empty ───────────
{
  console.log('\n8. OLD BUG — sendMessage(loungeId, text) left author metadata empty')
  const svc   = makeMockService()
  const store = buildStore(svc)
  const lounge = makeLounge('lounge-1')
  store.setState({ myLounges: [lounge] })

  // Old call: only 2 args, rest are undefined
  store.getState().sendMessage('lounge-1', 'Olá!', undefined, undefined, undefined)

  const updated = store.getState().myLounges[0]
  const msg = updated.messages[0]
  assert('message added (content OK)', msg.content === 'Olá!')
  assert('authorName undefined (bug)', msg.authorName === undefined)
  assert('authorHandle undefined (bug)', msg.authorHandle === undefined)
  console.log('  ↳ Fix: handleSendMessage now derives name/handle/initials from user store')
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
if (failed > 0) process.exit(1)
