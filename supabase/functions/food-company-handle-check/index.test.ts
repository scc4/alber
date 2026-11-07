// Roda com: deno test supabase/functions/food-company-handle-check/index.test.ts --allow-env --allow-net --allow-read
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
const KEY = 'k'.repeat(40)
Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)

import { handleRequest } from './index.ts'

type MockRoute = { pattern: string; status: number; body: unknown }

async function withMock<T>(routes: MockRoute[], fn: (urls: string[]) => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    urls.push(url)
    const r = routes.find((x) => url.includes(x.pattern))
    return new Response(JSON.stringify(r ? r.body : { error: `Unmocked ${url}` }), { status: r ? r.status : 500, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try { return await fn(urls) } finally { globalThis.fetch = orig }
}

function req(body: unknown, headers: Record<string, string> = { 'x-alber-food-key': KEY }): Request {
  return new Request('http://localhost/food-company-handle-check', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}
const USERS = (rows: unknown[], status = 200): MockRoute => ({ pattern: '/rest/v1/users', status, body: rows })
const COMPANIES = (rows: unknown[], status = 200): MockRoute => ({ pattern: '/rest/v1/companies', status, body: rows })

Deno.test('só POST, só com a chave do Food, corpo JSON objeto (nenhuma consulta ao banco)', async () => {
  await withMock([], async (urls) => {
    assertEquals((await handleRequest(new Request('http://localhost/x', { method: 'GET' }))).status, 405)
    for (const key of [undefined, 'errada', 'f'.repeat(41)]) {
      const r = await handleRequest(req({ handle: 'chocolateria' }, key === undefined ? {} : { 'x-alber-food-key': key }))
      assertEquals(r.status, 401)
    }
    assertEquals((await handleRequest(req('não é json'))).status, 400)
    assertEquals((await handleRequest(req([]))).status, 400)
    assertEquals(urls.length, 0)
  })
})

Deno.test('sem o segredo configurado a função recusa tudo (503)', async () => {
  Deno.env.delete('ALBER_FOOD_SERVICE_KEY')
  try {
    assertEquals((await handleRequest(req({ handle: 'chocolateria' }))).status, 503)
  } finally {
    Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)
  }
})

Deno.test('formato inválido → 422 HANDLE_INVALID, sem tocar no banco', async () => {
  await withMock([], async (urls) => {
    for (const bad of ['', 'ab', '1abc', '_abc', 'abc_', 'a__b', 'tem espaco', 'x'.repeat(21), 'acentuação', null, 42]) {
      const r = await handleRequest(req({ handle: bad }))
      assertEquals([r.status, (await r.json()).code], [422, 'HANDLE_INVALID'], String(bad))
    }
    assertEquals(urls.length, 0)
  })
})

Deno.test('@ livre → available true (aceita @ e maiúsculas)', async () => {
  for (const input of ['chocolateria', '@Chocolateria']) {
    await withMock([USERS([]), COMPANIES([])], async () => {
      const r = await handleRequest(req({ handle: input }))
      assertEquals([r.status, (await r.json()).available], [200, true])
    })
  }
})

Deno.test('@ de usuário (com ou sem @ gravado) ou de empresa ativa → available false', async () => {
  await withMock([USERS([{ id: 'u1' }]), COMPANIES([])], async () => {
    assertEquals((await (await handleRequest(req({ handle: 'fernando' }))).json()).available, false)
  })
  await withMock([USERS([]), COMPANIES([{ id: 'c1' }])], async () => {
    assertEquals((await (await handleRequest(req({ handle: 'chocolateria' }))).json()).available, false)
  })
})

Deno.test('consulta as duas formas do @ de usuário e ignora empresa apagada; nunca lê reservas', async () => {
  await withMock([USERS([]), COMPANIES([])], async (urls) => {
    await handleRequest(req({ handle: 'chocolateria' }))
    const u = decodeURIComponent(urls.find((x) => x.includes('/rest/v1/users'))!)
    assertEquals(u.includes('chocolateria') && u.includes('@chocolateria'), true)
    assertEquals(decodeURIComponent(urls.find((x) => x.includes('/rest/v1/companies'))!).includes('deleted_at=is.null'), true)
    assertEquals(urls.some((x) => x.includes('handle_reservations')), false)
  })
})

Deno.test('falha de leitura nunca vira "livre": 503 DB_ERROR', async () => {
  await withMock([USERS({ message: 'boom' }, 500), COMPANIES([])], async () => {
    const r = await handleRequest(req({ handle: 'chocolateria' }))
    assertEquals([r.status, (await r.json()).code], [503, 'DB_ERROR'])
  })
})
