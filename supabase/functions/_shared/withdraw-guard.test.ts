// Roda com: deno test supabase/functions/_shared/withdraw-guard.test.ts --allow-env --allow-net
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { checkCompanyWithdrawal, effectiveLimits, evaluateWithdrawal, LIMIT_REQUEST_CAPS, WITHDRAW_RULES, type WithdrawFacts } from './withdraw-guard.ts'

const NOW = new Date('2026-11-10T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const H = 3_600_000
const D = 24 * H

const facts = (over: Partial<WithdrawFacts> = {}): WithdrawFacts => ({
  ownerLinkReview: 'not_needed',
  kycApprovedAt: ago(90 * D),
  pixKeyChangedAt: null,
  amountBrl: 100,
  sumLast24hBrl: 0,
  now: NOW,
  ...over,
})
const code = (f: WithdrawFacts) => {
  const v = evaluateWithdrawal(f)
  return v.ok ? 'OK' : v.code
}

Deno.test('empresa conferida e madura: saque comum passa', () => {
  assertEquals(code(facts()), 'OK')
  assertEquals(code(facts({ ownerLinkReview: 'approved' })), 'OK')
})

Deno.test('vínculo em revisão ou recusado: não saca; legacy (anterior à regra) não bloqueia', () => {
  assertEquals(code(facts({ ownerLinkReview: 'pending' })), 'OWNER_LINK_PENDING')
  assertEquals(code(facts({ ownerLinkReview: 'rejected' })), 'OWNER_LINK_REJECTED')
  assertEquals(code(facts({ ownerLinkReview: 'legacy' })), 'OK')
})

Deno.test('chave Pix trocada há menos de 48 h bloqueia e diz quando volta; depois disso libera', () => {
  const v = evaluateWithdrawal(facts({ pixKeyChangedAt: ago(10 * H) }))
  assertEquals(v.ok, false)
  if (!v.ok) {
    assertEquals(v.code, 'PIX_KEY_RECENTLY_CHANGED')
    assertEquals(v.status, 403)
    assertEquals(v.extra?.available_at, new Date(NOW.getTime() - 10 * H + WITHDRAW_RULES.pixKeyWaitHours * H).toISOString())
  }
  assertEquals(code(facts({ pixKeyChangedAt: ago(47 * H) })), 'PIX_KEY_RECENTLY_CHANGED')
  assertEquals(code(facts({ pixKeyChangedAt: ago(49 * H) })), 'OK')
  assertEquals(code(facts({ pixKeyChangedAt: null })), 'OK') // primeira configuração não conta
})

Deno.test('primeiros 30 dias: R$ 1.000 por saque e R$ 2.000 por dia', () => {
  const nova = { kycApprovedAt: ago(5 * D) }
  assertEquals(code(facts({ ...nova, amountBrl: 1000 })), 'OK')
  assertEquals(code(facts({ ...nova, amountBrl: 1000.01 })), 'WITHDRAW_LIMIT_PER_TX')
  assertEquals(code(facts({ ...nova, amountBrl: 1000, sumLast24hBrl: 1000 })), 'OK') // 2.000 no dia: no limite
  assertEquals(code(facts({ ...nova, amountBrl: 500, sumLast24hBrl: 1600 })), 'WITHDRAW_LIMIT_DAILY')
})

Deno.test('depois de 30 dias: R$ 5.000 por saque e R$ 20.000 por dia', () => {
  const madura = { kycApprovedAt: ago(31 * D) }
  assertEquals(code(facts({ ...madura, amountBrl: 5000 })), 'OK')
  assertEquals(code(facts({ ...madura, amountBrl: 5001 })), 'WITHDRAW_LIMIT_PER_TX')
  assertEquals(code(facts({ ...madura, amountBrl: 5000, sumLast24hBrl: 15000 })), 'OK')
  assertEquals(code(facts({ ...madura, amountBrl: 5000, sumLast24hBrl: 15001 })), 'WITHDRAW_LIMIT_DAILY')
})

Deno.test('sem data de aprovação do KYC: tratada como nova (limites menores)', () => {
  assertEquals(code(facts({ kycApprovedAt: null, amountBrl: 1500 })), 'WITHDRAW_LIMIT_PER_TX')
})

Deno.test('o limite de valor fica no dia 30 exato: 29 dias é nova, 30 dias é madura', () => {
  assertEquals(code(facts({ kycApprovedAt: ago(29 * D + 23 * H), amountBrl: 2000 })), 'WITHDRAW_LIMIT_PER_TX')
  assertEquals(code(facts({ kycApprovedAt: ago(30 * D), amountBrl: 2000 })), 'OK')
})

Deno.test('a ordem das regras: revisão primeiro, depois a chave Pix, depois os valores', () => {
  assertEquals(code(facts({ ownerLinkReview: 'pending', pixKeyChangedAt: ago(H), amountBrl: 99999 })), 'OWNER_LINK_PENDING')
  assertEquals(code(facts({ pixKeyChangedAt: ago(H), amountBrl: 99999 })), 'PIX_KEY_RECENTLY_CHANGED')
})

// ── Leitura no banco: erro de leitura NUNCA libera ───────────────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function fakeDb(opts: { company?: Record<string, unknown> | null; companyErr?: boolean; tx?: { amount: number | string }[]; txErr?: boolean }): any {
  const chain = (result: () => unknown) => {
    // deno-lint-ignore no-explicit-any
    const c: any = new Proxy(() => {}, {
      get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res(result()) : prop === 'maybeSingle' ? () => Promise.resolve(result()) : () => c),
    })
    return c
  }
  return {
    from: (table: string) =>
      chain(() => {
        if (table === 'companies') return opts.companyErr ? { data: null, error: { message: 'x' } } : { data: opts.company ?? null, error: null }
        return opts.txErr ? { data: null, error: { message: 'x' } } : { data: opts.tx ?? [], error: null }
      }),
  }
}
const company = { owner_link_review: 'not_needed', kyc_approved_at: ago(90 * D), pix_key_changed_at: null }

Deno.test('lê a empresa e soma os saques das últimas 24 h do banco (amount pode vir como texto)', async () => {
  // 13.000 já sacados + 5.000 = 18.000: dentro dos R$ 20.000 por dia
  assertEquals((await checkCompanyWithdrawal(fakeDb({ company, tx: [{ amount: 6000 }, { amount: '7000' }] }), 'c1', 5000, NOW)).ok, true)
  // 19.000 já sacados + 2.000 = 21.000: passa do limite diário
  const daily = await checkCompanyWithdrawal(fakeDb({ company, tx: [{ amount: 5000 }, { amount: 5000 }, { amount: 5000 }, { amount: '4000' }] }), 'c1', 2000, NOW)
  assertEquals(daily.ok === false && daily.code, 'WITHDRAW_LIMIT_DAILY')
})

Deno.test('empresa que não existe ou erro de leitura: recusa (503), nunca libera', async () => {
  for (const db of [fakeDb({ company: null }), fakeDb({ companyErr: true }), fakeDb({ company, txErr: true })]) {
    const v = await checkCompanyWithdrawal(db, 'c1', 10, NOW)
    assertEquals(v.ok === false && [v.code, v.status], ['WITHDRAW_CHECK_FAILED', 503])
  }
})

// ── Aumento de limite aprovado pela equipe (decisão de 04/11/2026) ───────────────────────────────────────────────────────────────
Deno.test('limite aprovado substitui os dois limites padrão, de empresa nova ou madura', () => {
  for (const kycApprovedAt of [ago(5 * D), ago(90 * D), null]) {
    const aprovado = { kycApprovedAt, overridePerTxBrl: 8000, overridePerDayBrl: 30000 }
    assertEquals(code(facts({ ...aprovado, amountBrl: 8000 })), 'OK')
    assertEquals(code(facts({ ...aprovado, amountBrl: 8001 })), 'WITHDRAW_LIMIT_PER_TX')
    assertEquals(code(facts({ ...aprovado, amountBrl: 8000, sumLast24hBrl: 22000 })), 'OK')
    assertEquals(code(facts({ ...aprovado, amountBrl: 8000, sumLast24hBrl: 22001 })), 'WITHDRAW_LIMIT_DAILY')
  }
})

Deno.test('o aumento mexe só nos valores: vínculo em revisão e chave Pix recente continuam barrando', () => {
  const aprovado = { overridePerTxBrl: 50000, overridePerDayBrl: 200000, amountBrl: 100 }
  assertEquals(code(facts({ ...aprovado, ownerLinkReview: 'pending' })), 'OWNER_LINK_PENDING')
  assertEquals(code(facts({ ...aprovado, ownerLinkReview: 'rejected' })), 'OWNER_LINK_REJECTED')
  assertEquals(code(facts({ ...aprovado, pixKeyChangedAt: ago(H) })), 'PIX_KEY_RECENTLY_CHANGED')
})

Deno.test('limites efetivos: padrão por idade ou aprovado; aprovado incompleto ou incoerente é ignorado', () => {
  const base = { kycApprovedAt: ago(5 * D), now: NOW }
  assertEquals(effectiveLimits({ ...base }), { perTxBrl: 1000, perDayBrl: 2000, source: 'default', isNew: true })
  assertEquals(effectiveLimits({ kycApprovedAt: ago(40 * D), now: NOW }), { perTxBrl: 5000, perDayBrl: 20000, source: 'default', isNew: false })
  assertEquals(effectiveLimits({ ...base, overridePerTxBrl: 4000, overridePerDayBrl: 9000 }), { perTxBrl: 4000, perDayBrl: 9000, source: 'approved', isNew: true })
  assertEquals(effectiveLimits({ ...base, overridePerTxBrl: '4000' as unknown as number, overridePerDayBrl: '9000' as unknown as number }).source, 'approved') // numeric chega como texto
  for (const bad of [{ overridePerTxBrl: 4000, overridePerDayBrl: null }, { overridePerTxBrl: null, overridePerDayBrl: 9000 }, { overridePerTxBrl: 9000, overridePerDayBrl: 4000 }, { overridePerTxBrl: 0, overridePerDayBrl: 10 }, { overridePerTxBrl: -5, overridePerDayBrl: 10 }]) {
    assertEquals(effectiveLimits({ ...base, ...bad }).source, 'default', JSON.stringify(bad))
  }
  assertEquals([LIMIT_REQUEST_CAPS.perTxBrl, LIMIT_REQUEST_CAPS.perDayBrl], [500000, 2000000])
})

Deno.test('a mensagem de limite excedido manda pedir aumento, não o suporte', () => {
  const v = evaluateWithdrawal(facts({ kycApprovedAt: ago(5 * D), amountBrl: 1500 }))
  assertEquals(v.ok === false && v.message.includes('peça um aumento do limite'), true)
  assertEquals(v.ok === false && v.message.includes('nos primeiros 30 dias'), true)
  const aprovado = evaluateWithdrawal(facts({ overridePerTxBrl: 2000, overridePerDayBrl: 4000, amountBrl: 2500 }))
  assertEquals(aprovado.ok === false && aprovado.message.includes('nos primeiros 30 dias'), false) // limite aprovado não é o de empresa nova
})

Deno.test('lê os limites aprovados do banco (numeric pode vir como texto) e os aplica', async () => {
  const aprovada = { ...company, withdraw_limit_per_tx_brl: '9000.00', withdraw_limit_per_day_brl: '40000.00' }
  assertEquals((await checkCompanyWithdrawal(fakeDb({ company: aprovada, tx: [{ amount: 30000 }] }), 'c1', 9000, NOW)).ok, true)
  const acima = await checkCompanyWithdrawal(fakeDb({ company: aprovada }), 'c1', 9001, NOW)
  assertEquals(acima.ok === false && acima.code, 'WITHDRAW_LIMIT_PER_TX')
  const diario = await checkCompanyWithdrawal(fakeDb({ company: aprovada, tx: [{ amount: 35000 }] }), 'c1', 6000, NOW)
  assertEquals(diario.ok === false && diario.code, 'WITHDRAW_LIMIT_DAILY')
})
