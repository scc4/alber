// E2E logic test: lounge active-toggle with real Zustand store (no React)
// Replicates the exact store slice used by the Switch in lounge/[id].tsx
// Run: node scripts/test-lounge-toggle-store.mjs

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

// ── Minimal lounge store slice (mirrors store/lounge.store.ts) ────────────────

function makeMockLounge(id, name = 'Test Lounge') {
  return { id, name, role: 'owner', accent: '#5BCEC9', bgDark: '#0a0a0a',
           imageUri: null, visibility: 'public', memberCount: 1,
           ownerId: 'user-1', members: [], pendingRequests: [], events: [],
           messages: [], inviteToken: null, createdAt: new Date().toISOString(),
           description: '' }
}

function buildStore() {
  return createStore((set, get) => ({
    myLounges:     [],
    exploring:     [],
    currentLounge: null,

    getLoungeById: (id) => {
      const { myLounges, exploring } = get()
      return myLounges.find(l => l.id === id) ?? exploring.find(l => l.id === id)
    },

    setCurrentLounge: (id) => {
      const lounge = get().getLoungeById(id) ?? null
      set({ currentLounge: lounge })
    },
  }))
}

// ── Helper: derive isActive the same way the component does ──────────────────

function isActive(store, loungeId) {
  return store.getState().currentLounge?.id === loungeId
}

// ── Test 1: toggle ON when lounge is in myLounges ────────────────────────────
console.log('\n=== Test suite: lounge-toggle-store (real Zustand) ===\n')

{
  console.log('1. Toggle ON — lounge present in myLounges')
  const store = buildStore()
  const lounge = makeMockLounge('lounge-001')
  store.setState({ myLounges: [lounge] })

  assert('currentLounge starts null', store.getState().currentLounge === null)
  assert('isActive starts false', !isActive(store, 'lounge-001'))

  store.getState().setCurrentLounge('lounge-001')

  assert('currentLounge set after toggle ON', store.getState().currentLounge?.id === 'lounge-001')
  assert('isActive true after toggle ON', isActive(store, 'lounge-001'))
}

// ── Test 2: toggle OFF clears currentLounge ───────────────────────────────────

{
  console.log('\n2. Toggle OFF — clears currentLounge')
  const store = buildStore()
  const lounge = makeMockLounge('lounge-001')
  store.setState({ myLounges: [lounge], currentLounge: lounge })

  assert('isActive starts true', isActive(store, 'lounge-001'))

  store.getState().setCurrentLounge('')   // handleToggleActive(false)

  assert('currentLounge null after toggle OFF', store.getState().currentLounge === null)
  assert('isActive false after toggle OFF', !isActive(store, 'lounge-001'))
}

// ── Test 3: CRITICAL — lounge missing from myLounges and exploring ────────────
// This is the scenario that would cause "no effect"

{
  console.log('\n3. CRITICAL — lounge NOT in myLounges or exploring (silent fail)')
  const store = buildStore()
  // Intentionally empty: no lounges loaded yet
  store.setState({ myLounges: [], exploring: [] })

  assert('getLoungeById returns undefined', store.getState().getLoungeById('lounge-001') === undefined)

  store.getState().setCurrentLounge('lounge-001')

  assert('currentLounge stays null (getLoungeById returned undefined)', store.getState().currentLounge === null)
  assert('isActive still false — toggle had NO EFFECT', !isActive(store, 'lounge-001'))

  console.log('  ⚠  This confirms the bug: if getLoungeById finds nothing, toggle is silently ignored')
}

// ── Test 4: toggle ON when lounge is only in exploring (not myLounges) ────────

{
  console.log('\n4. Lounge only in exploring (member, not owner)')
  const store = buildStore()
  const lounge = makeMockLounge('lounge-002')
  store.setState({ myLounges: [], exploring: [lounge] })

  store.getState().setCurrentLounge('lounge-002')

  assert('currentLounge set when lounge is in exploring', store.getState().currentLounge?.id === 'lounge-002')
  assert('isActive true from exploring lounge', isActive(store, 'lounge-002'))
}

// ── Test 5: fetchLounge adds to myLounges, then toggle works ─────────────────

{
  console.log('\n5. Lounge added to myLounges by fetchLounge, then toggle works')
  const store = buildStore()

  // Simulate fetchLounge completing (adds lounge to myLounges)
  const lounge = makeMockLounge('lounge-003')
  store.setState(s => ({
    myLounges: s.myLounges.some(l => l.id === 'lounge-003')
      ? s.myLounges
      : [...s.myLounges, lounge]
  }))

  assert('lounge in myLounges after fetch', store.getState().myLounges.length === 1)

  store.getState().setCurrentLounge('lounge-003')

  assert('toggle works after fetchLounge', store.getState().currentLounge?.id === 'lounge-003')
}

// ── Test 6: FIX VALIDATION — setCurrentLounge should use id directly ─────────
// Fix: if getLoungeById returns undefined, fall back to setting currentLounge
// with a minimal stub so the toggle visually works even before full data loads

{
  console.log('\n6. FIX — setCurrentLounge with direct id fallback')

  function buildFixedStore() {
    return createStore((set, get) => ({
      myLounges:     [],
      exploring:     [],
      currentLounge: null,

      getLoungeById: (id) => {
        const { myLounges, exploring } = get()
        return myLounges.find(l => l.id === id) ?? exploring.find(l => l.id === id)
      },

      // FIXED: set currentLounge.id directly instead of relying on getLoungeById
      setCurrentLounge: (id) => {
        if (!id) { set({ currentLounge: null }); return }
        const lounge = get().getLoungeById(id) ?? { id } // fallback: minimal stub
        set({ currentLounge: lounge })
      },
    }))
  }

  const store = buildFixedStore()
  // No lounges loaded yet
  store.setState({ myLounges: [], exploring: [] })

  store.getState().setCurrentLounge('lounge-001')

  assert('FIX: currentLounge.id set even without full lounge data', store.getState().currentLounge?.id === 'lounge-001')
  assert('FIX: isActive true after toggle ON', isActive(store, 'lounge-001'))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
if (failed > 0) {
  console.log('\n⚠  Tests 3 confirms the bug root cause.')
  console.log('   Fix: store/lounge.store.ts setCurrentLounge must not silently fail')
  console.log('   when getLoungeById returns undefined.\n')
  process.exit(1)
}
console.log()
