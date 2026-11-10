// Roda com: deno test supabase/functions/_shared/sms-code.test.ts --allow-env
import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { checkSmsCode, newSmsCode, smsCodeHash, SMS_MAX_ATTEMPTS } from './sms-code.ts'

Deno.env.set('ALBER_CREDENTIAL_PEPPER', 'test-pepper-test-pepper-test-pepper-0123')

type Row = { id: string; user_id: string; purpose: string; code_hash: string; attempts: number; used_at: string | null; expires_at: string; created_at: string }

/** Cliente mínimo em memória com a cadeia que checkSmsCode usa (from/select/eq/is/gt/order/limit/maybeSingle e update/eq/is/select). */
function fakeDb(rows: Row[]) {
  return {
    from(_t: string) {
      const f: { eq: [string, unknown][]; isNull: string[]; gt?: [string, string] } = { eq: [], isNull: [] }
      const match = (r: Row) => f.eq.every(([k, v]) => (r as Record<string, unknown>)[k] === v) && f.isNull.every((k) => (r as Record<string, unknown>)[k] === null) && (!f.gt || (r as Record<string, unknown>)[f.gt[0]]! > f.gt[1])
      const q = {
        select: (_c?: string) => q,
        eq: (k: string, v: unknown) => { f.eq.push([k, v]); return q },
        is: (k: string, _v: null) => { f.isNull.push(k); return q },
        gt: (k: string, v: string) => { f.gt = [k, v]; return q },
        order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: rows.filter(match).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null }),
        update: (patch: Partial<Row>) => ({
          eq: (k: string, v: unknown) => {
            f.eq.push([k, v])
            const u = {
              is: (k2: string, _v: null) => {
                f.isNull.push(k2)
                const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, patch))
                return { select: async (_c: string) => ({ data: hit.map((r) => ({ id: r.id })) }), then: (res: (x: unknown) => void) => res({}) }
              },
            }
            return u
          },
        }),
      }
      return q
    },
  }
}

const U = 'user-1'
async function row(code: string, over: Partial<Row> = {}): Promise<Row> {
  return { id: 'c1', user_id: U, purpose: 'pin_change', code_hash: await smsCodeHash(U, 'pin_change', code), attempts: 0, used_at: null, expires_at: new Date(Date.now() + 600_000).toISOString(), created_at: new Date().toISOString(), ...over }
}

Deno.test('newSmsCode: 6 dígitos, sem zero à esquerda, e não é sempre o mesmo', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) { const c = newSmsCode(); assert(/^[1-9]\d{5}$/.test(c), c); seen.add(c) }
  assert(seen.size > 150)
})

Deno.test('smsCodeHash: HMAC preso ao usuário e à finalidade; nunca o código', async () => {
  const h = await smsCodeHash(U, 'pin_change', '123456')
  assertNotEquals(h, '123456')
  assertEquals(h.length, 64)
  assertNotEquals(h, await smsCodeHash('user-2', 'pin_change', '123456'))
  assertNotEquals(h, await smsCodeHash(U, 'account_delete', '123456'))
})

Deno.test('código certo: ok uma vez só (uso único)', async () => {
  const db = fakeDb([await row('123456')])
  assertEquals(await checkSmsCode(db, U, 'pin_change', '123456'), 'ok')
  assertEquals(await checkSmsCode(db, U, 'pin_change', '123456'), 'expired') // já usado
})

Deno.test('código errado conta tentativa; na 5ª o código é queimado e nem o certo vale mais', async () => {
  const rows = [await row('123456')]
  const db = fakeDb(rows)
  for (let i = 1; i < SMS_MAX_ATTEMPTS; i++) { assertEquals(await checkSmsCode(db, U, 'pin_change', '000000'), 'invalid'); assertEquals(rows[0]!.attempts, i) }
  assertEquals(await checkSmsCode(db, U, 'pin_change', '000000'), 'invalid') // 5ª
  assertEquals(rows[0]!.used_at !== null, true)
  assertEquals(await checkSmsCode(db, U, 'pin_change', '123456'), 'expired')
})

Deno.test('formato inválido, expirado e de outra finalidade nunca conferem', async () => {
  // um banco novo por caso: depois de 5 erros o código é queimado (ver o teste acima)
  for (const bad of [undefined, null, 123456, '', '12345', '1234567', 'abcdef', '123 456']) assertEquals(await checkSmsCode(fakeDb([await row('123456')]), U, 'pin_change', bad), 'invalid')
  assertEquals(await checkSmsCode(fakeDb([await row('123456', { expires_at: new Date(Date.now() - 1000).toISOString() })]), U, 'pin_change', '123456'), 'expired')
  assertEquals(await checkSmsCode(fakeDb([await row('123456')]), U, 'account_delete', '123456'), 'expired')
})
