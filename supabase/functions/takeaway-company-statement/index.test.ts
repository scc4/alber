// Unit tests — takeaway-company-statement (saldo e extrato da subconta do restaurante, somente leitura)
// Roda com: deno test supabase/functions/takeaway-company-statement/index.test.ts --allow-env --allow-net

import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

const KEY = 'f'.repeat(40)
Deno.env.set('ALBER_FOOD_SERVICE_KEY', KEY)
Deno.env.set('ASAAS_API_KEY', 'enc-secret-enc-secret-enc-secret-1234')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('SUPABASE_URL', 'https://supabase.test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')

import { aesEncrypt } from '../_shared/crypto.ts'
import { handleRequest } from './index.ts'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const req = (body: unknown = { company_id: COMPANY }, key: string | null = KEY, method = 'POST') =>
  new Request('http://localhost/x', { method, headers: key === null ? {} : { 'x-alber-food-key': key }, body: method === 'GET' ? undefined : JSON.stringify(body) })

async function run(r: Request, company: Record<string, unknown> | null, asaas: (url: string, key: string | null) => Response) {
  const orig = globalThis.fetch
  const asaasCalls: { url: string; key: string | null }[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('https://supabase.test')) {
      if (url.includes('/rest/v1/companies')) return new Response(JSON.stringify(company), { status: 200, headers: { 'content-type': 'application/vnd.pgrst.object+json' } })
      return new Response('[]', { status: 201 })
    }
    const key = new Headers(init?.headers).get('access_token')
    asaasCalls.push({ url, key })
    return asaas(url, key)
  }) as typeof fetch
  try {
    return { res: await handleRequest(r), asaasCalls }
  } finally {
    globalThis.fetch = orig
  }
}

const ok = (url: string): Response =>
  url.includes('/finance/balance')
    ? new Response(JSON.stringify({ balance: 77.5 }), { status: 200 })
    : new Response(JSON.stringify({ data: [{ id: 'ft_1', type: 'PAYMENT_SPLIT', value: 12.34, balance: 77.5, date: '2026-10-26', description: 'Cobrança de Maria da Silva', paymentId: 'pay_x' }] }), { status: 200 })

Deno.test('só POST, só com a chave do Alber Food (a do admin não vale)', async () => {
  assertEquals((await run(req({}, KEY, 'GET'), null, ok)).res.status, 405)
  for (const k of [null, 'errado', KEY + 'x']) assertEquals((await run(req(undefined, k), null, ok)).res.status, 401)
  Deno.env.set('ALBER_ADMIN_SERVICE_KEY', 'a'.repeat(40))
  assertEquals((await run(req(undefined, 'a'.repeat(40)), null, ok)).res.status, 401)
})

Deno.test('company_id inválido: 422 sem consultar nada', async () => {
  const r = await run(req({ company_id: 'x' }), null, ok)
  assertEquals(r.res.status, 422)
  assertEquals(r.asaasCalls.length, 0)
})

Deno.test('empresa inexistente, removida ou sem KYC aprovado: não consulta o Asaas', async () => {
  const enc = await aesEncrypt('sub-key', Deno.env.get('ASAAS_API_KEY')!)
  for (const [company, status] of [[null, 404], [{ id: COMPANY, asaas_api_key_enc: enc, kyc_status: 'approved', deleted_at: '2026-01-01' }, 404], [{ id: COMPANY, asaas_api_key_enc: enc, kyc_status: 'pending', deleted_at: null }, 409], [{ id: COMPANY, asaas_api_key_enc: null, kyc_status: 'approved', deleted_at: null }, 409]] as const) {
    const r = await run(req(), company as never, ok)
    assertEquals(r.res.status, status)
    assertEquals(r.asaasCalls.length, 0)
  }
})

Deno.test('usa a chave da SUBCONTA (nunca a da conta pai) e devolve saldo e extrato sem descrição', async () => {
  const enc = await aesEncrypt('sub-key', Deno.env.get('ASAAS_API_KEY')!)
  const r = await run(req(), { id: COMPANY, asaas_api_key_enc: enc, kyc_status: 'approved', deleted_at: null }, ok)
  assertEquals(r.res.status, 200)
  const body = await r.res.json()
  assertEquals(body.balance_cents, 7750)
  assertEquals(body.movements[0], { id: 'ft_1', type: 'PAYMENT_SPLIT', value_cents: 1234, balance_cents: 7750, date: '2026-10-26', linked: true })
  assert(!JSON.stringify(body).includes('Maria'))
  assert(r.asaasCalls.length > 0 && r.asaasCalls.every((c) => c.key === 'sub-key'))
})

Deno.test('falha do Asaas: 502 genérico, sem detalhe', async () => {
  const enc = await aesEncrypt('sub-key', Deno.env.get('ASAAS_API_KEY')!)
  const r = await run(req(), { id: COMPANY, asaas_api_key_enc: enc, kyc_status: 'approved', deleted_at: null }, () => new Response(JSON.stringify({ errors: [{ description: 'segredo interno' }] }), { status: 500 }))
  assertEquals(r.res.status, 502)
  assert(!(await r.res.text()).includes('segredo interno'))
})
