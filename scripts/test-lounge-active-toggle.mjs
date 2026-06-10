// Test: lounge active-toggle logic (node --input-type=module)
// Validates the three behaviours exercised by the Switch on the member/manager
// CTA row in app/(app)/lounge/[id].tsx without any React Native dependency.

let passed = 0
let failed = 0

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}`)
    failed++
  }
}

// ── Simulate store state ──────────────────────────────────────────────────────

function makeStore(initialCurrentId = null) {
  let currentId = initialCurrentId
  return {
    getCurrentId: () => currentId,
    setCurrentLounge: (id) => { currentId = id || null },
  }
}

// ── handleToggleActive logic (extracted from component) ──────────────────────

function makeToggleHandler(store, loungeId) {
  return function handleToggleActive(val) {
    store.setCurrentLounge(val ? loungeId : '')
  }
}

// ── isActive derived value ────────────────────────────────────────────────────

function isActive(store, loungeId) {
  return store.getCurrentId() === loungeId
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Test suite: lounge active-toggle ===\n')

// 1. Toggle ON from inactive state
{
  console.log('1. Toggle ON — lounge not active initially')
  const store = makeStore(null)
  const toggleActive = makeToggleHandler(store, 'lounge-abc')

  assert('isActive starts false', !isActive(store, 'lounge-abc'))
  toggleActive(true)
  assert('isActive is true after toggle ON', isActive(store, 'lounge-abc'))
  assert('store.currentId set to loungeId', store.getCurrentId() === 'lounge-abc')
}

// 2. Toggle OFF from active state
{
  console.log('\n2. Toggle OFF — lounge is currently active')
  const store = makeStore('lounge-abc')
  const toggleActive = makeToggleHandler(store, 'lounge-abc')

  assert('isActive starts true', isActive(store, 'lounge-abc'))
  toggleActive(false)
  assert('isActive is false after toggle OFF', !isActive(store, 'lounge-abc'))
  assert('store.currentId cleared', store.getCurrentId() === null)
}

// 3. Switching between two lounges
{
  console.log('\n3. Switch active lounge from A to B')
  const store = makeStore('lounge-A')
  const toggleA = makeToggleHandler(store, 'lounge-A')
  const toggleB = makeToggleHandler(store, 'lounge-B')

  assert('lounge-A starts active', isActive(store, 'lounge-A'))
  assert('lounge-B starts inactive', !isActive(store, 'lounge-B'))

  toggleB(true)   // activate B
  assert('lounge-B is now active', isActive(store, 'lounge-B'))
  assert('lounge-A is now inactive', !isActive(store, 'lounge-A'))

  toggleA(true)   // activate A again
  assert('lounge-A is active again', isActive(store, 'lounge-A'))
  assert('lounge-B is inactive again', !isActive(store, 'lounge-B'))
}

// 4. Toggle ON is idempotent
{
  console.log('\n4. Toggle ON twice — idempotent')
  const store = makeStore(null)
  const toggleActive = makeToggleHandler(store, 'lounge-xyz')

  toggleActive(true)
  toggleActive(true)
  assert('still active after double ON', isActive(store, 'lounge-xyz'))
}

// 5. Toggle OFF when already inactive — no crash, stays inactive
{
  console.log('\n5. Toggle OFF when already inactive — no-op')
  const store = makeStore(null)
  const toggleActive = makeToggleHandler(store, 'lounge-xyz')

  toggleActive(false)
  assert('remains inactive', !isActive(store, 'lounge-xyz'))
  assert('store.currentId stays null', store.getCurrentId() === null)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
if (failed > 0) process.exit(1)
