// E2E logic test: lounge active-toggle with real Zustand store (no React)
// Replicates the exact store slice used by the Switch in lounge/[id].tsx
// Run: node scripts/test-lounge-toggle-store.js

'use strict'
const { createStore } = require('../node_modules/zustand/vanilla.js')

let passed = 0
let failed = 0

function assert(label, condition, extra) {
  if (condition) {
    console.log('  ✓ ' + label)
    passed++
  } else {
    console.error('  ✗ ' + label + (extra ? ' — ' + extra : ''))
    failed++
  }
}

// ── Minimal lounge store slice (mirrors store/lounge.store.ts) ────────────────

function makeMockLounge(id) {
  return { id, name: 'Test', role: 'owner', accent: '#5BCEC9', bgDark: '#0a0a0a',
           imageUri: null, visibility: 'public', memberCount: 1, ownerId: 'u1',
           members: [], pendingRequests: [], events: [], messages: [],
           inviteToken: null, createdAt: new Date().toISOString(), description: '' }
}

function buildStore() {
  return createStore((set, get) => ({
    myLounges:     [],
    exploring:     [],
    currentLounge: null,

    getLoungeById: function(id) {
      var s = get()
      return s.myLounges.find(function(l) { return l.id === id }) ||
             s.exploring.find(function(l) { return l.id === id }) ||
             undefined
    },

    // CURRENT implementation — exactly as in store/lounge.store.ts
    setCurrentLounge: function(id) {
      var lounge = get().getLoungeById(id) || null
      set({ currentLounge: lounge })
    },
  }))
}

function isActive(store, loungeId) {
  var c = store.getState().currentLounge
  return c ? c.id === loungeId : false
}

console.log('\n=== E2E: lounge active-toggle (real Zustand v5) ===\n')

// ── Test 1: Toggle ON when lounge is in myLounges ─────────────────────────────
{
  console.log('1. Toggle ON — lounge present in myLounges')
  var store = buildStore()
  var l = makeMockLounge('l-001')
  store.setState({ myLounges: [l] })

  assert('currentLounge starts null', store.getState().currentLounge === null)
  store.getState().setCurrentLounge('l-001')
  assert('currentLounge.id set to l-001', store.getState().currentLounge?.id === 'l-001')
  assert('isActive true', isActive(store, 'l-001'))
}

// ── Test 2: Toggle OFF clears currentLounge ───────────────────────────────────
{
  console.log('\n2. Toggle OFF — clears currentLounge')
  var store2 = buildStore()
  var l2 = makeMockLounge('l-001')
  store2.setState({ myLounges: [l2], currentLounge: l2 })

  assert('isActive starts true', isActive(store2, 'l-001'))
  store2.getState().setCurrentLounge('')   // handleToggleActive(false) → setActive('')
  assert('currentLounge null', store2.getState().currentLounge === null)
  assert('isActive false', !isActive(store2, 'l-001'))
}

// ── Test 3: CRITICAL — lounge NOT found by getLoungeById → toggle silent fail ──
{
  console.log('\n3. CRITICAL — getLoungeById returns undefined (race: detail opened before fetch)')
  var store3 = buildStore()
  // myLounges is empty (fetchLounge hasn't completed yet)
  store3.setState({ myLounges: [], exploring: [] })

  assert('getLoungeById returns undefined', store3.getState().getLoungeById('l-001') === undefined)

  store3.getState().setCurrentLounge('l-001')

  var stateAfter = store3.getState().currentLounge
  assert('currentLounge is null — toggle had NO EFFECT (BUG)', stateAfter === null)
  console.log('  ↳ Root cause confirmed: setCurrentLounge falls back to null when lounge not loaded')
}

// ── Test 4: Lounge only in exploring ─────────────────────────────────────────
{
  console.log('\n4. Lounge only in exploring array (works)')
  var store4 = buildStore()
  var l4 = makeMockLounge('l-002')
  store4.setState({ myLounges: [], exploring: [l4] })

  store4.getState().setCurrentLounge('l-002')
  assert('isActive true from exploring', isActive(store4, 'l-002'))
}

// ── Test 5: Fix validation ────────────────────────────────────────────────────
{
  console.log('\n5. FIX — setCurrentLounge uses id directly as fallback')

  function buildFixedStore() {
    return createStore(function(set, get) {
      return {
        myLounges:     [],
        exploring:     [],
        currentLounge: null,

        getLoungeById: function(id) {
          var s = get()
          return s.myLounges.find(function(l) { return l.id === id }) ||
                 s.exploring.find(function(l) { return l.id === id }) ||
                 undefined
        },

        // FIXED: never silently fail — fall back to { id } stub so isActive works
        setCurrentLounge: function(id) {
          if (!id) { set({ currentLounge: null }); return }
          var lounge = get().getLoungeById(id) || { id: id }
          set({ currentLounge: lounge })
        },
      }
    })
  }

  var fixed = buildFixedStore()
  fixed.setState({ myLounges: [], exploring: [] })  // nothing loaded

  fixed.getState().setCurrentLounge('l-001')

  assert('FIX: currentLounge.id = l-001 even before full load',
    fixed.getState().currentLounge?.id === 'l-001')
  assert('FIX: isActive true', isActive(fixed, 'l-001'))

  fixed.getState().setCurrentLounge('')
  assert('FIX: toggle OFF still works', fixed.getState().currentLounge === null)
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===\n')
if (failed > 0) process.exit(1)
