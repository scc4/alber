// E2E unit tests — auth-question Edge Function
// Roda com: deno test supabase/functions/auth-question/index.test.ts --allow-env --allow-net
//
// Cobre principalmente o que foi adicionado para corrigir o comportamento de
// erro de PIN/pergunta de segurança no login:
// - PIN errado agora é detectado e contado aqui (antes só era logado em
//   auth-login, que na prática quase nunca era alcançado com um PIN errado
//   real, já que o app não tem como montar a tela de opções sem um challenge).
// - sinal explícito pin_invalid (em vez de um challenge vazio ambíguo)
// - bloqueio temporário (login_blocked_until) checado ANTES de tentar o PIN
// - exclude_question_id evita repetir a mesma pergunta que acabou de ser
//   respondida errado

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { bcryptHash, sha256hex } from '../_shared/crypto.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }

function mockFetch(routes: MockRoute[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    for (const r of routes) {
      const methodOk = !r.method || r.method.toUpperCase() === method
      if (methodOk && url.includes(r.pattern)) {
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }
}

function withMock<T>(routes: MockRoute[], fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = mockFetch(routes) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

const VALID_CPF = '52998224725'

function makeReq(body: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/auth-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: VALID_CPF, pin_hash: 'right-pin-hash', ...body }),
  })
}

function userRow(overrides: Record<string, unknown> = {}) {
  return [{ id: 'db-user-1', auth_id: '11111111-1111-4111-8111-111111111111', login_blocked_until: null, ...overrides }]
}

Deno.test('sem identifier/pin_hash → resposta vazia (200, sem erro)', async () => {
  const res  = await withMock([], () => handleRequest(makeReq({ identifier: '' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.options, [])
})

Deno.test('usuário não encontrado → resposta vazia, sem revelar existência', async () => {
  const routes: MockRoute[] = [{ pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] }]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.options, [])
})

Deno.test('conta já bloqueada (login_blocked_until no futuro) → blocked:true, nem tenta o PIN', async () => {
  const future = new Date(Date.now() + 30 * 60_000).toISOString()
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow({ login_blocked_until: future }) },
  ]
  let adminUsersCalled = false
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/auth/v1/admin/users/')) adminUsersCalled = true
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  let res: Response
  try {
    res = await handleRequest(makeReq())
  } finally {
    globalThis.fetch = orig
  }
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.blocked, true)
  assertEquals(data.blocked_until, future)
  assertEquals(adminUsersCalled, false)
})

Deno.test('PIN errado (1ª vez) → pin_invalid:true, sem bloquear ainda', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: '1', app_metadata: { pin_bcrypt: await bcryptHash('correct-pin') } } },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
    { pattern: '/rest/v1/audit_logs', method: 'GET', status: 200, body: [{ id: 'a' }] }, // só esta falha até agora
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ pin_hash: 'wrong-pin' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.pin_invalid, true)
  assertEquals(data.blocked, undefined)
})

Deno.test('PIN errado pela 3ª vez na janela → blocked:true e grava login_blocked_until', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: '1', app_metadata: { pin_bcrypt: await bcryptHash('correct-pin') } } },
    { pattern: '/rest/v1/audit_logs', method: 'POST', status: 201, body: {} },
    { pattern: '/rest/v1/audit_logs', method: 'GET', status: 200, body: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  ]
  let patchedBody: Record<string, unknown> | null = null
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'PATCH' && url.includes('/rest/v1/users')) {
      patchedBody = JSON.parse(init!.body as string)
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return mockFetch(routes)(input, init)
  }) as typeof fetch

  let res: Response
  try {
    res = await handleRequest(makeReq({ pin_hash: 'wrong-pin' }))
  } finally {
    globalThis.fetch = orig
  }
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.blocked, true)
  assertEquals(typeof data.blocked_until, 'string')
  assertEquals(typeof patchedBody!.login_blocked_until, 'string')
})

Deno.test('PIN correto — gera challenge com question_id e 5 opções (1 real + 4 decoys)', async () => {
  const answerSha = await sha256hex('rex')
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: '1', app_metadata: { pin_bcrypt: await bcryptHash('right-pin-hash') } } },
    {
      pattern: '/rest/v1/security_questions', method: 'GET', status: 200,
      body: [{ id: 'q1', position: 1, question: 'Nome do pet?', answer_sha256: answerSha, answer_normalized: 'rex' }],
    },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq({ pin_hash: 'right-pin-hash' })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.question, 'Nome do pet?')
  assertEquals(data.question_id, 'q1')
  assertEquals(data.options.length, 5)
  assertEquals(data.options.some((o: { hash: string }) => o.hash === answerSha), true)
})

Deno.test('exclude_question_id evita repetir a pergunta recém-errada quando há outra elegível', async () => {
  const answer1 = await sha256hex('rex')
  const answer2 = await sha256hex('luna')
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: '1', app_metadata: { pin_bcrypt: await bcryptHash('right-pin-hash') } } },
    {
      pattern: '/rest/v1/security_questions', method: 'GET', status: 200,
      body: [
        { id: 'q1', position: 1, question: 'Nome do pet?',    answer_sha256: answer1, answer_normalized: 'rex' },
        { id: 'q2', position: 2, question: 'Cidade natal?',   answer_sha256: answer2, answer_normalized: 'luna' },
      ],
    },
  ]
  const res  = await withMock(routes, () =>
    handleRequest(makeReq({ pin_hash: 'right-pin-hash', exclude_question_id: 'q1' }))
  )
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.question_id, 'q2') // só resta q2 elegível depois de excluir q1
  assertNotEquals(data.question_id, 'q1')
})

Deno.test('exclude_question_id ignorado se for a única pergunta elegível (evita dead-end)', async () => {
  const answer1 = await sha256hex('rex')
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: '1', app_metadata: { pin_bcrypt: await bcryptHash('right-pin-hash') } } },
    {
      pattern: '/rest/v1/security_questions', method: 'GET', status: 200,
      body: [{ id: 'q1', position: 1, question: 'Nome do pet?', answer_sha256: answer1, answer_normalized: 'rex' }],
    },
  ]
  const res  = await withMock(routes, () =>
    handleRequest(makeReq({ pin_hash: 'right-pin-hash', exclude_question_id: 'q1' }))
  )
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.question_id, 'q1') // única opção — não pode ficar sem pergunta nenhuma
})

Deno.test('PIN em pares sem pin_sha256 cadastrado → pin_setup_required:true', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: userRow() },
    { pattern: '/auth/v1/admin/users/', method: 'GET', status: 200, body: { id: '1', app_metadata: { pin_bcrypt: await bcryptHash('x') } } },
  ]
  const pairsPayload = JSON.stringify([[1,2],[3,4],[5,6],[7,8],[9,0],[1,3]])
  const res  = await withMock(routes, () => handleRequest(makeReq({ pin_hash: pairsPayload })))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.pin_setup_required, true)
})
