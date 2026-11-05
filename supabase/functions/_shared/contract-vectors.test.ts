// Roda com: deno test supabase/functions/_shared/contract-vectors.test.ts --allow-env --allow-net
//
// Vetores de contrato com o Alber Food. Os MESMOS valores literais estão em alber-food/tests/contract-vectors.test.ts. Se um lado mudar o
// formato (JSON canônico, HMAC, validação de documento), o teste do outro lado quebra antes de produção. Não "conserte" mudando só um lado.
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { canonicalJson } from './food-op.ts'
import { signRelease, verifyRelease } from './food-release.ts'
import { validateCnpj } from './cnpj.ts'
import { validateCpf } from './cpf.ts'

const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'

const RELEASE = {
  kind: 'company_release',
  request_id: '33333333-3333-4333-8333-333333333333',
  owner_ref: '22222222-2222-4222-8222-222222222222',
  cnpj_hash: 'a'.repeat(64),
  cpf_hash: 'b'.repeat(64),
  decided_at: '2026-11-10T11:00:00.000Z',
  nonce: 'Zm9vZC1yZWxlYXNlLTAwMDE',
  issued_at: '2026-11-10T12:00:00.000Z',
  expires_at: '2026-11-10T12:01:30.000Z',
}
const SIGNATURE = 'v1=5a06c259ef0562f6c4ce272f6e59f97fa839ba1de621bd5be9f0206d424b5cc9'

Deno.test('contrato com o Food: atestado de liberação, JSON canônico e assinatura conhecidos', async () => {
  assertEquals(
    canonicalJson(RELEASE),
    '{"cnpj_hash":"' + 'a'.repeat(64) + '","cpf_hash":"' + 'b'.repeat(64) + '","decided_at":"2026-11-10T11:00:00.000Z","expires_at":"2026-11-10T12:01:30.000Z","issued_at":"2026-11-10T12:00:00.000Z","kind":"company_release","nonce":"Zm9vZC1yZWxlYXNlLTAwMDE","owner_ref":"22222222-2222-4222-8222-222222222222","request_id":"33333333-3333-4333-8333-333333333333"}',
  )
  assertEquals(await signRelease(RELEASE, SECRET), SIGNATURE)
})

Deno.test('contrato com o Food: a assinatura calculada pelo Food passa na verificação do Alber (e só dentro da validade)', async () => {
  const headers = new Headers({ 'x-food-release-signature': SIGNATURE })
  const expected = { ownerRef: RELEASE.owner_ref, cnpjHash: RELEASE.cnpj_hash, cpfHash: RELEASE.cpf_hash }
  const ok = await verifyRelease(headers, RELEASE, expected, new Date('2026-11-10T12:00:30.000Z'), SECRET)
  assert(ok.ok)
  const late = await verifyRelease(headers, RELEASE, expected, new Date('2026-11-10T12:02:00.000Z'), SECRET)
  assertEquals(late.ok, false)
})

Deno.test('contrato com o Food: CPF e CNPJ aceitam e recusam os mesmos documentos', () => {
  for (const v of ['52998224725', '529.982.247-25', '11144477735']) assertEquals(validateCpf(v), true, v)
  for (const v of ['11111111111', '12345678900', '5299822472', '00000000000', '']) assertEquals(validateCpf(v), false, v)
  for (const v of ['11222333000181', '11.222.333/0001-81']) assertEquals(validateCnpj(v), true, v)
  for (const v of ['11111111111111', '11222333000182', '1122233300018', '']) assertEquals(validateCnpj(v), false, v)
})
