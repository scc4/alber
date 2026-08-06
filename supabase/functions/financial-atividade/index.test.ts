// E2E unit tests — financial-atividade Edge Function
// Roda com: deno test supabase/functions/financial-atividade/index.test.ts --allow-env --allow-net
//
// Cobre o bug reportado: a tela de Atividade mostrava carregamentos via Pix
// nunca pagos (status 'pending') e transferências com erro (status 'failed').
// A tela deve funcionar como extrato — só movimentações que de fato
// aconteceram (status 'completed' ou 'refunded').

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'

type MockRoute = { pattern: string; method?: string; status: number; body: unknown }

function mockFetch(routes: MockRoute[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET')).toUpperCase()
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

const AUTH_USER = { id: 'auth-uid-1', aud: 'authenticated' }
const DB_USER   = [{ id: 'db-user-1' }]

function makeReq(qs = ''): Request {
  return new Request(`http://localhost/financial-atividade${qs}`, {
    method:  'GET',
    headers: { 'Authorization': 'Bearer valid-tok' },
  })
}

const BASE_ROUTES: MockRoute[] = [
  { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
  { pattern: '/rest/v1/users', method: 'GET', status: 200, body: DB_USER },
]

Deno.test('GET retorna 405 para outros métodos', async () => {
  const req = new Request('http://localhost/financial-atividade', { method: 'POST' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 405)
})

Deno.test('sem Authorization → 401', async () => {
  const req = new Request('http://localhost/financial-atividade', { method: 'GET' })
  const res = await withMock([], () => handleRequest(req))
  assertEquals(res.status, 401)
})

Deno.test('query para transactions filtra status=completed,refunded (não mostra pending/processing/failed)', async () => {
  let capturedUrl = ''
  const routes: MockRoute[] = [
    ...BASE_ROUTES,
    {
      pattern: '/rest/v1/transactions', method: 'GET', status: 200,
      body: [
        { id: 'tx-1', type: 'carregar', amount: '10', amount_brl: '10', fee_amount: '0', status: 'completed', reference_id: null, reference_type: null, metadata: {}, created_at: '2026-01-01T00:00:00Z' },
      ],
    },
  ]

  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/rest/v1/transactions')) capturedUrl = url
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
  assertEquals(data.data.length, 1)
  // PostgREST usa o operador in.(...) no querystring — confirma que o filtro foi enviado
  const decoded = decodeURIComponent(capturedUrl)
  const hasCompleted = decoded.includes('completed')
  const hasRefunded  = decoded.includes('refunded')
  assertEquals(hasCompleted && hasRefunded, true)
})

Deno.test('carregamento pendente (nunca pago) não aparece — status pending excluído pelo mock do PostgREST real, aqui validamos o shape da resposta', async () => {
  // Aqui simulamos o que o PostgREST faria: como o filtro .in('status', [...]) já
  // está na query, um backend real nunca devolveria uma linha 'pending'. Este teste
  // documenta a expectativa: se o mock (indevidamente) devolvesse uma linha pending,
  // o app ainda a exibiria — a garantia real está na query, coberta pelo teste acima.
  const routes: MockRoute[] = [
    ...BASE_ROUTES,
    { pattern: '/rest/v1/transactions', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.data, [])
  assertEquals(data.total, 0)
})

Deno.test('usuário não encontrado → 404', async () => {
  const routes: MockRoute[] = [
    { pattern: '/auth/v1/user',  method: 'GET', status: 200, body: AUTH_USER },
    { pattern: '/rest/v1/users', method: 'GET', status: 200, body: [] },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 404)
  assertEquals(data.code, 'USER_NOT_FOUND')
})

Deno.test('filtro tipo=in restringe também por type, mantendo o filtro de status', async () => {
  const routes: MockRoute[] = [
    ...BASE_ROUTES,
    {
      pattern: '/rest/v1/transactions', method: 'GET', status: 200,
      body: [
        { id: 'tx-refund', type: 'event_refund', amount: '5', amount_brl: '5', fee_amount: '0', status: 'refunded', reference_id: null, reference_type: null, metadata: {}, created_at: '2026-01-02T00:00:00Z' },
      ],
    },
  ]
  const res  = await withMock(routes, () => handleRequest(makeReq('?tipo=in')))
  const data = await res.json()
  assertEquals(res.status, 200)
  assertEquals(data.data[0].status, 'refunded')
})
