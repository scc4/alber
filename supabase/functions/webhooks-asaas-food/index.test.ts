// Unit tests — webhooks-asaas-food (conta pai do Asaas -> Alber Food)
// Roda com: deno test supabase/functions/webhooks-asaas-food/index.test.ts --allow-env --allow-net

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

const TOKEN = 't'.repeat(40)
const SECRET = 's'.repeat(40)
Deno.env.set('FOOD_ASAAS_WEBHOOK_TOKEN', TOKEN)
Deno.env.set('FOOD_WEBHOOK_URL', 'https://food.test/api/internal/asaas-event')
Deno.env.set('FOOD_WEBHOOK_SECRET', SECRET)

import { handleRequest } from './index.ts'
import { signFoodEvent } from '../_shared/food-webhook.ts'

const REF = 'food_22222222-2222-4222-8222-222222222222'
const evt = (over: Record<string, unknown> = {}) => ({
  id: 'evt_1&1', event: 'PAYMENT_CONFIRMED', dateCreated: '2026-10-26 10:00:00', account: { id: 'acc', ownerId: null },
  payment: { id: 'pay_1', value: 86, netValue: 82.51, externalReference: REF, billingType: 'PIX', status: 'CONFIRMED' }, ...over,
})
const req = (body: unknown, token: string | null = TOKEN) =>
  new Request('http://localhost/webhooks-asaas-food', { method: 'POST', headers: token === null ? {} : { 'asaas-access-token': token }, body: typeof body === 'string' ? body : JSON.stringify(body) })

function run(r: Request, forwardStatus: number | 'throw' = 200): Promise<{ res: Response; sent: Request | null }> {
  const orig = globalThis.fetch
  let sent: Request | null = null
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent = new Request(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init)
    if (forwardStatus === 'throw') throw new Error('rede')
    return new Response('{}', { status: forwardStatus })
  }) as typeof fetch
  return handleRequest(r).then((res) => ({ res, sent })).finally(() => { globalThis.fetch = orig })
}

Deno.test('só POST; token ausente ou errado: 401 sem repassar nada', async () => {
  assertEquals((await run(new Request('http://localhost/x', { method: 'GET' }))).res.status, 405)
  for (const t of [null, 'errado', TOKEN.slice(0, -1), TOKEN + 'x', 'x'.repeat(40)]) {
    const r = await run(req(evt(), t))
    assertEquals(r.res.status, 401)
    assertEquals(r.sent, null)
  }
})

Deno.test('o token do webhook das subcontas NÃO vale aqui', async () => {
  Deno.env.set('ASAAS_WEBHOOK_SECRET', 'a'.repeat(40))
  assertEquals((await run(req(evt(), 'a'.repeat(40)))).res.status, 401)
})

Deno.test('sem token configurado (ou curto demais) a função recusa tudo com 503', async () => {
  Deno.env.delete('FOOD_ASAAS_WEBHOOK_TOKEN')
  try {
    assertEquals((await run(req(evt()))).res.status, 503)
    Deno.env.set('FOOD_ASAAS_WEBHOOK_TOKEN', 'curto')
    assertEquals((await run(req(evt(), 'curto'))).res.status, 503)
  } finally {
    Deno.env.set('FOOD_ASAAS_WEBHOOK_TOKEN', TOKEN)
  }
})

Deno.test('cobrança do Alber Food: repassa assinado, em centavos, com o custo real do Asaas', async () => {
  const r = await run(req(evt()))
  assertEquals(r.res.status, 200)
  const raw = await r.sent!.text()
  assertEquals(JSON.parse(raw), { id: 'evt_1&1', event: 'PAYMENT_CONFIRMED', payment_id: 'pay_1', external_reference: REF, amount_cents: 8600, gateway_cost_cents: 349 })
  assertEquals(r.sent!.headers.get('x-alber-signature'), await signFoodEvent(SECRET, r.sent!.headers.get('x-alber-timestamp')!, raw))
})

Deno.test('repassa também estorno, vencimento e divergência de split', async () => {
  for (const event of ['PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_SPLIT_DIVERGENCE_BLOCK']) {
    const r = await run(req(evt({ event })))
    assertEquals(r.res.status, 200, event)
    assertEquals(JSON.parse(await r.sent!.text()).event, event)
  }
})

Deno.test('o que não é do Alber Food é descartado com 200, sem repassar', async () => {
  const other = [
    evt({ payment: { id: 'pay_9', value: 10, externalReference: 'transacao-do-app' } }),
    evt({ payment: { id: 'pay_9', value: 10 } }),
    evt({ payment: undefined }),
    evt({ event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED' }),
    evt({ event: 'TRANSFER_DONE' }),
  ]
  for (const body of other) {
    const r = await run(req(body))
    assertEquals(r.res.status, 200)
    assertEquals(r.sent, null)
  }
})

Deno.test('corpo inválido: 400; falha do Alber Food: 502 (o Asaas reenvia); recusa 4xx: 200 (repetir não adianta)', async () => {
  assertEquals((await run(req('{ruim'))).res.status, 400)
  assertEquals((await run(req(evt()), 503)).res.status, 502)
  assertEquals((await run(req(evt()), 'throw')).res.status, 502)
  assertEquals((await run(req(evt()), 401)).res.status, 200)
})

Deno.test('segredo gravado com quebra de linha, espaço ou aspas (arquivo .env no Windows) ainda confere', async () => {
  const CR = String.fromCharCode(13)
  const LF = String.fromCharCode(10)
  try {
    for (const stored of [TOKEN + CR, ' ' + TOKEN + ' ', '"' + TOKEN + '"', TOKEN + CR + LF]) {
      Deno.env.set('FOOD_ASAAS_WEBHOOK_TOKEN', stored)
      assertEquals((await run(req(evt(), TOKEN))).res.status, 200, JSON.stringify(stored))
      assertEquals((await run(req(evt(), TOKEN + 'x'))).res.status, 401)
    }
  } finally {
    Deno.env.set('FOOD_ASAAS_WEBHOOK_TOKEN', TOKEN)
  }
})
