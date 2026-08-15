// Unit test — _shared/asaas.ts createAsaasAccount
// Roda com: deno test supabase/functions/_shared/asaas.test.ts --allow-env --allow-net
//
// Regressão do bug que derrubava 100% dos cadastros: a Asaas rejeita o
// POST /accounts inteiro se o payload de webhooks tiver um evento que ela não
// reconhece. 'TRANSFER_CONFIRMED' não existe na API da Asaas — o evento certo
// é 'TRANSFER_DONE' (docs.asaas.com/docs/transfer-events). Este teste garante
// que o payload enviado nunca mais volta a usar o nome errado.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')

import { createAsaasAccount } from './asaas.ts'

Deno.test('createAsaasAccount envia TRANSFER_DONE (nunca TRANSFER_CONFIRMED) nos webhooks de transferência', async () => {
  let capturedBody: Record<string, unknown> | null = null
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/accounts') && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      capturedBody = JSON.parse(init!.body as string)
      return new Response(JSON.stringify({ id: 'acc-1', apiKey: 'key-1', walletId: 'wallet-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: `Unmocked ${url}` }), { status: 500 })
  }) as typeof fetch

  try {
    await createAsaasAccount(
      {
        name: 'Teste', email: 'teste@teste.com', cpfCnpj: '52998224725', birthDate: '1990-01-01',
        phone: '11999999999', mobilePhone: '11999999999', address: 'Rua X', addressNumber: '1',
        province: 'Bairro', postalCode: '01000000',
        webhookUrl: 'http://x/kyc', pixWebhookUrl: 'http://x/pix', webhookSecret: 'secret',
      },
      'parent-key',
    )
  } finally {
    globalThis.fetch = orig
  }

  const webhooks = (capturedBody as unknown as { webhooks: { events: string[] }[] }).webhooks
  const pixWebhookEvents = webhooks.find(w => w.events.some(e => e.startsWith('TRANSFER')))!.events

  assertEquals(pixWebhookEvents.includes('TRANSFER_DONE'), true)
  assertEquals(pixWebhookEvents.includes('TRANSFER_CONFIRMED'), false)
})
