// E2E: fluxo completo de convite para Lounge privado
// Uso:
//   TEST_OWNER_HANDLE=alice TEST_OWNER_PIN=<sha256> TEST_OWNER_ANSWER=<sha256> \
//   TEST_MEMBER_HANDLE=bob  TEST_MEMBER_PIN=<sha256> TEST_MEMBER_ANSWER=<sha256> \
//   node scripts/test-invite-flow.mjs
//
// PIN/ANSWER = SHA-256 hex (64 chars) do PIN/resposta normalizada

const SUPABASE_URL = 'https://cxknwpvnabfetcsaengv.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4a253cHZuYWJmZXRjc2Flbmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1OTY4NDYsImV4cCI6MjA5NTE3Mjg0Nn0.Pios1ke-j3-aH_F1-Fh57Bd9OmuvbP38xs7cMNobx8Y'
const BFF          = `${SUPABASE_URL}/functions/v1`
const REST         = `${SUPABASE_URL}/rest/v1`

const OWNER_HANDLE  = process.env.TEST_OWNER_HANDLE
const OWNER_PIN     = process.env.TEST_OWNER_PIN
const OWNER_ANSWER  = process.env.TEST_OWNER_ANSWER
const MEMBER_HANDLE = process.env.TEST_MEMBER_HANDLE
const MEMBER_PIN    = process.env.TEST_MEMBER_PIN
const MEMBER_ANSWER = process.env.TEST_MEMBER_ANSWER

let passed = 0
let failed = 0

function ok(label, extra = '') {
  console.log(`  ✓ ${label}${extra ? '  → ' + extra : ''}`)
  passed++
}
function fail(label, extra = '') {
  console.error(`  ✗ ${label}${extra ? '  → ' + extra : ''}`)
  failed++
}
function assert(label, condition, extra = '') {
  condition ? ok(label, extra) : fail(label, extra)
}
function header(title) {
  console.log(`\n── ${title} ──`)
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function callEF(path, body, token) {
  const res = await fetch(`${BFF}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        ANON_KEY,
      'Authorization': `Bearer ${token ?? ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function restGet(endpoint, token) {
  const res = await fetch(`${REST}/${endpoint}`, {
    headers: {
      'apikey':        ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Accept':        'application/json',
    },
  })
  const data = await res.json().catch(() => [])
  return { status: res.status, data }
}

// ── Domain helpers ─────────────────────────────────────────────────────────────

async function login(handle, pinSha256, answerSha256) {
  const { status, data } = await callEF('auth-login', {
    cpf:                  `@${handle.replace(/^@/, '')}`,
    pin_hash:             pinSha256,
    security_answer_hash: answerSha256,
  })
  if (status !== 200) throw new Error(`login @${handle}: HTTP ${status} – ${JSON.stringify(data)}`)
  return data // { token, user: { id, name, handle, ... } }
}

async function getMyPrivateLounges(token) {
  // Uses the same REST query as lounge.service.ts getMyLounges
  const { status, data } = await restGet(
    'space_members?select=id,role,status,is_primary,' +
    'space:spaces!space_members_space_id_fkey(id,name,type,invite_token,status)' +
    '&status=eq.active&order=created_at.asc',
    token,
  )
  if (status !== 200) throw new Error(`space_members REST: HTTP ${status}`)
  return (data ?? []).filter(r => r.role === 'owner' && r.space?.type === 'closed' && r.space?.invite_token)
}

async function createPrivateLounge(token) {
  const { status, data } = await callEF('lounge-create', {
    name:        'Test Invite Lounge',
    type:        'closed',
    description: 'Lounge criado pelo script de teste de convite',
    skin:        { accent: '#7C3AED', bgDark: '#0a0a0a' },
    image_url:   null,
  }, token)
  if (status !== 200) throw new Error(`lounge-create: HTTP ${status} – ${JSON.stringify(data)}`)
  return data // { space_id, name, type, skin, invite_token }
}

// ── Verificar variáveis ────────────────────────────────────────────────────────

console.log('\n=== E2E: fluxo de convite Lounge privado ===')

const missing = [
  !OWNER_HANDLE  && 'TEST_OWNER_HANDLE',
  !OWNER_PIN     && 'TEST_OWNER_PIN',
  !OWNER_ANSWER  && 'TEST_OWNER_ANSWER',
  !MEMBER_HANDLE && 'TEST_MEMBER_HANDLE',
  !MEMBER_PIN    && 'TEST_MEMBER_PIN',
  !MEMBER_ANSWER && 'TEST_MEMBER_ANSWER',
].filter(Boolean)

if (missing.length > 0) {
  console.error(`\nFaltam variáveis de ambiente: ${missing.join(', ')}`)
  console.error('\nExemplo:')
  console.error('  TEST_OWNER_HANDLE=alice  TEST_OWNER_PIN=<sha256>  TEST_OWNER_ANSWER=<sha256> \\')
  console.error('  TEST_MEMBER_HANDLE=bob   TEST_MEMBER_PIN=<sha256> TEST_MEMBER_ANSWER=<sha256> \\')
  console.error('  node scripts/test-invite-flow.mjs')
  process.exit(1)
}

// ── 1. Login ───────────────────────────────────────────────────────────────────

header('1. Login dos dois usuários')

let ownerToken, ownerId, memberToken, memberId

try {
  const r  = await login(OWNER_HANDLE, OWNER_PIN, OWNER_ANSWER)
  ownerToken = r.token
  ownerId    = r.user?.id
  ok('owner login', `id=${ownerId?.slice(0,8)}… handle=@${r.user?.handle}`)
} catch (e) {
  fail('owner login', e.message)
  process.exit(1)
}

try {
  const r   = await login(MEMBER_HANDLE, MEMBER_PIN, MEMBER_ANSWER)
  memberToken = r.token
  memberId    = r.user?.id
  ok('member login', `id=${memberId?.slice(0,8)}… handle=@${r.user?.handle}`)
} catch (e) {
  fail('member login', e.message)
  process.exit(1)
}

// ── 2. Encontrar ou criar Lounge privado ───────────────────────────────────────

header('2. Lounge privado do owner')
let loungeId, inviteToken

try {
  const privateLounges = await getMyPrivateLounges(ownerToken)

  if (privateLounges.length > 0) {
    const row = privateLounges[0]
    loungeId    = row.space.id
    inviteToken = row.space.invite_token
    ok('lounge privado encontrado', `id=${loungeId?.slice(0,8)}… nome="${row.space.name}"`)
    ok('invite_token presente',      inviteToken?.slice(0,12) + '…')
  } else {
    console.log('  → Nenhum lounge privado do owner — criando...')
    const res = await createPrivateLounge(ownerToken)
    loungeId    = res.space_id
    inviteToken = res.invite_token
    assert('space_id retornado',    !!loungeId,    `space_id=${loungeId}`)
    assert('invite_token gerado',   !!inviteToken, `token=${inviteToken?.slice(0,12)}…`)
    assert('type = closed',         res.type === 'closed', `type=${res.type}`)
  }
} catch (e) {
  fail('obter/criar lounge', e.message)
  process.exit(1)
}

// ── 3. lounge-invite-preview (membro ainda fora) ──────────────────────────────

header('3. lounge-invite-preview — token válido')
{
  const { status, data } = await callEF('lounge-invite-preview', { invite_token: inviteToken }, memberToken)
  assert('status 200',             status === 200,              `status=${status}`)
  assert('id correto',             data.id === loungeId,        `id=${data.id}`)
  assert('name presente',          typeof data.name === 'string' && data.name.length > 0, `name="${data.name}"`)
  assert('type = closed',          data.type === 'closed',      `type=${data.type}`)
  assert('member_count >= 1',      typeof data.member_count === 'number' && data.member_count >= 1, `count=${data.member_count}`)
  assert('skin.accent presente',   !!data.skin?.accent,         `accent=${data.skin?.accent}`)
  assert('sem campos sensíveis',   data.invite_token === undefined, 'invite_token deve estar oculto')
}

// ── 4. lounge-invite-preview — token inválido ─────────────────────────────────

header('4. lounge-invite-preview — token inválido')
{
  const { status, data } = await callEF('lounge-invite-preview', { invite_token: 'token-invalido-xyz' }, memberToken)
  assert('status 404',             status === 404,                  `status=${status}`)
  assert('code INVITE_NOT_FOUND',  data.code === 'INVITE_NOT_FOUND', `code=${data.code}`)
}

// ── 5. lounge-invite-preview — sem autenticação ───────────────────────────────

header('5. lounge-invite-preview — sem Bearer token')
{
  const { status, data } = await callEF('lounge-invite-preview', { invite_token: inviteToken }, null)
  assert('status 401',    status === 401,      `status=${status}`)
  assert('code UNAUTHORIZED', data.code === 'UNAUTHORIZED', `code=${data.code}`)
}

// ── 6. lounge-join via invite_token ───────────────────────────────────────────

header('6. lounge-join via invite_token')
{
  const { status, data } = await callEF('lounge-join', { invite_token: inviteToken }, memberToken)
  assert('status 200',          status === 200,              `status=${status} data=${JSON.stringify(data)}`)
  assert('space_id correto',    data.space_id === loungeId,  `esperado=${loungeId} recebido=${data.space_id}`)
  assert('status = active',     data.status === 'active',    `status=${data.status}`)
}

// ── 7. lounge-join idempotente (membro já ativo) ──────────────────────────────

header('7. lounge-join — membro já ativo (deve recusar)')
{
  const { status, data } = await callEF('lounge-join', { invite_token: inviteToken }, memberToken)
  assert('status 422',         status === 422,                   `status=${status}`)
  assert('code ALREADY_MEMBER', data.code === 'ALREADY_MEMBER',  `code=${data.code}`)
}

// ── 8. lounge-invite-preview com membro já dentro ─────────────────────────────

header('8. lounge-invite-preview — membro já ativo (preview ainda funciona)')
{
  const { status, data } = await callEF('lounge-invite-preview', { invite_token: inviteToken }, memberToken)
  assert('status 200',         status === 200,  `status=${status}`)
  assert('dados retornados',   !!data.id && !!data.name, `id=${data.id} name="${data.name}"`)
}

// ── 9. lounge-join sem token e sem space_id ───────────────────────────────────

header('9. lounge-join — sem parâmetros')
{
  const { status, data } = await callEF('lounge-join', {}, memberToken)
  assert('status 400',         status === 400,          `status=${status}`)
  assert('code MISSING_FIELDS', data.code === 'MISSING_FIELDS', `code=${data.code}`)
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n=== Resultados: ${passed} ✓  ${failed} ✗ ===\n`)
if (failed > 0) process.exit(1)
