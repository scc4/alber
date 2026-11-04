// Roda com: deno test supabase/functions/_shared/food-company.test.ts --allow-env --allow-net --allow-read
// Garantias de segurança do desenho "empresa do Alber Food sem usuário do app" que não pertencem a uma função só.
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { ago, COMPANY_ID, CNPJ, D, EVP, makeWorld, OWNER_REF, installWorld } from './food-test-kit.ts'
import { loadOwnedCompany, maskPixKey, pixKeyAvailableAt, pixKeyView, adminClient, FOOD_WITHDRAW_FEE_ENABLED, foodWithdrawFeeBrl, type FoodCompany } from './food-company.ts'
import { requireCompanyPermission, resolveWalletContext } from './company-permissions.ts'
import { createCompanyForOwner } from './company.ts'
import { destinationDigest } from './food-op.ts'

Deno.test('o app nunca movimenta a empresa do Alber Food: nem usuário qualquer, nem operador inventado, em nenhuma permissão financeira', async () => {
  const w = await makeWorld()
  const restore = installWorld(w)
  try {
    const admin = adminClient()
    for (const permission of ['descarregar', 'transferir', 'carregar', 'receber', 'ver_saldo', 'ver_extrato'] as const) {
      assertEquals((await requireCompanyPermission(admin, OWNER_REF, COMPANY_ID, permission)).ok, false) // nem o owner_ref como se fosse userId
      assertEquals((await requireCompanyPermission(admin, 'user-qualquer', COMPANY_ID, permission)).ok, false)
    }
    const wallet = await resolveWalletContext(admin, 'user-qualquer', COMPANY_ID, 'descarregar', { asaas_api_key_enc: null, kyc_status: 'approved', account_status: 'active', created_at: ago(D) })
    assertEquals(wallet.ok, false)
  } finally {
    restore()
  }
})

Deno.test('caminho do app em createCompanyForOwner: continua sem owner_ref/origin no insert (não depende da migration 058)', async () => {
  const w = await makeWorld({ override: null, rows: { users: [{ id: 'user-1', phone: '11988887777', cpf: 'hash', account_status: 'active', kyc_status: 'approved' }] } })
  const restore = installWorld(w)
  try {
    const r = await createCompanyForOwner(adminClient(), 'user-1', {
      cnpj: CNPJ, handle: 'minhaempresa', company_name: 'Minha Empresa LTDA', company_type: 'LIMITED', income_value: 5000,
      address: { street: 'Rua X', number: '100', neighborhood: 'Centro', zip_code: '01000000' },
    }, { sleep: async () => {} })
    assert(r.ok, JSON.stringify(r))
    const inserted = w.db.calls('POST', 'companies')[0]?.body as Record<string, unknown>
    assertEquals(inserted.owner_id, 'user-1')
    assert(!('owner_ref' in inserted) && !('origin' in inserted))
  } finally {
    restore()
  }
})

Deno.test('máscara, espera de 48 h e visão da chave Pix', async () => {
  assertEquals(maskPixKey('cnpj', '11222333000181'), '11222333***')
  assertEquals(maskPixKey('random', EVP), `${EVP.slice(0, 8)}...`)
  assertEquals(pixKeyAvailableAt(null), null)
  assertEquals(pixKeyAvailableAt('2026-11-10T00:00:00.000Z'), '2026-11-12T00:00:00.000Z')

  const w = await makeWorld({ pixKey: null })
  const none = await pixKeyView(w.db.rows('companies')[0] as unknown as FoodCompany)
  assertEquals(none, { configured: false, type: null, masked: null, digest: null, changed_at: null, available_at: null })

  const withKey = await makeWorld()
  const view = await pixKeyView(withKey.db.rows('companies')[0] as unknown as FoodCompany)
  assertEquals([view.configured, view.type, view.digest], [true, 'cnpj', await destinationDigest(COMPANY_ID, CNPJ)])

  // chave guardada que não decifra: configurada, mas sem máscara nem digest (nunca derruba a leitura)
  const broken = await makeWorld({ override: { pix_key: 'lixo-que-nao-decifra' } })
  const bv = await pixKeyView(broken.db.rows('companies')[0] as unknown as FoodCompany)
  assertEquals([bv.configured, bv.masked, bv.digest], [true, null, null])
})

Deno.test('leitura da empresa: erro de banco 503, inexistente/removida 404, dono errado 403', async () => {
  const w = await makeWorld()
  const restore = installWorld(w)
  try {
    const admin = adminClient()
    assertEquals((await loadOwnedCompany(admin, COMPANY_ID, OWNER_REF)).ok, true)
    const wrong = await loadOwnedCompany(admin, COMPANY_ID, 'outro')
    assertEquals(wrong.ok ? 0 : wrong.res.status, 403)
    const allowed = await loadOwnedCompany(admin, COMPANY_ID, 'outro', [OWNER_REF]) // aceita também o dono de antes/depois (troca de titular)
    assertEquals(allowed.ok, true)
    w.db.failOn.push({ method: 'GET', table: 'companies' })
    const down = await loadOwnedCompany(admin, COMPANY_ID, OWNER_REF)
    assertEquals(down.ok ? 0 : down.res.status, 503)
  } finally {
    restore()
  }
})

Deno.test('taxa do saque: desligada (decisão pendente), valor 0 sem consultar rates', async () => {
  assertEquals(FOOD_WITHDRAW_FEE_ENABLED, false)
  const w = await makeWorld({ rows: { rates: [{ type: 'cashout', rate: '0.03' }] } })
  const restore = installWorld(w)
  try {
    assertEquals(await foodWithdrawFeeBrl(adminClient(), 1500), 0)
    assertEquals(w.db.calls('GET', 'rates').length, 0)
  } finally {
    restore()
  }
})
