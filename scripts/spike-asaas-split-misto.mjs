// SPIKE DESCARTÁVEL — split misto (fixo + percentual sobre o líquido) na cobrança da SUBCONTA. SÓ SANDBOX.
// Uso: ASAAS_SANDBOX_KEY='$aact_hmlg_...' node scripts/spike-asaas-split-misto.mjs   (gera CNPJ de teste válido)
const KEY = process.env.ASAAS_SANDBOX_KEY ?? ''
if (!KEY.includes('hmlg')) { console.error('Recuso: chave não parece de SANDBOX.'); process.exit(1) }
const BASE = 'https://sandbox.asaas.com/api/v3'
async function call(method, path, key, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', access_token: key, 'User-Agent': 'alber-spike' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let d; try { d = JSON.parse(t) } catch { d = t }; return { status: r.status, data: d }
}
const show = (t, v) => console.log(`\n## ${t}\n` + JSON.stringify(v, null, 2))
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => k in (o ?? {})).map((k) => [k, o[k]]))
function cnpj() { const b = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]); const dv = (n) => { const w = n.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const s = n.reduce((a, x, i) => a + x * w[i], 0) % 11; return s < 2 ? 0 : 11 - s }; b.push(dv(b)); b.push(dv(b)); return b.join('') }
const today = new Date().toISOString().slice(0, 10), n = Date.now()
const parent = await call('GET', '/wallets/', KEY); if (parent.status !== 200) { console.error('chave recusada', parent.status); process.exit(1) }
const pw = parent.data.data[0].id
const acc = await call('POST', '/accounts', KEY, { name: 'Restaurante Misto ' + n, email: `misto+${n}@example.com`, cpfCnpj: cnpj(), companyType: 'LIMITED', mobilePhone: '11987654321', incomeValue: 10000, address: 'Av Paulista', addressNumber: '1000', province: 'Bela Vista', postalCode: '01310100' })
if (!acc.data.apiKey) { show('subconta falhou', acc.data); process.exit(1) }
const sk = acc.data.apiKey
const cust = await call('POST', '/customers', sk, { name: 'Cliente Teste', cpfCnpj: '24971563792', notificationDisabled: true })
const mk = (label, split, value = 100) => call('POST', '/payments', sk, { customer: cust.data.id, billingType: 'PIX', value, dueDate: today, description: 'Misto', externalReference: `food_misto_${n}_${label}`, split })
const cases = {
  'A: duas entradas mesma carteira (fixo + %)': [{ walletId: pw, fixedValue: 0.5 }, { walletId: pw, percentualValue: 5 }],
  'B: uma entrada com fixedValue E percentualValue': [{ walletId: pw, fixedValue: 0.5, percentualValue: 5 }],
  'C: referência (só %)': [{ walletId: pw, percentualValue: 5 }],
}
let i = 0
for (const [label, split] of Object.entries(cases)) {
  const p = await mk('c' + i++, split)
  show(label, pick(p.data, ['id', 'status', 'value', 'netValue', 'split', 'errors']))
  if (p.data.id) {
    const g = await call('GET', `/payments/${p.data.id}`, sk); show('  GET split', g.data.split)
    const pay = await call('POST', `/payments/${p.data.id}/receiveInCash`, sk, { paymentDate: today, value: 100 }); show('  receiveInCash', pick(pay.data, ['status', 'netValue', 'errors']))
    const sp = await call('GET', `/payments/${p.data.id}/splits`, sk).catch(() => null); if (sp) show('  /splits', sp.data)
    globalThis['p' + i] = p.data.id
  }
}
const rec = await call('GET', '/payments/splits/received?limit=10', KEY); show('splits recebidos pela mãe (últimos)', (rec.data.data ?? []).map((x) => pick(x, ['payment', 'status', 'totalValue', 'fixedValue', 'percentualValue', 'cancellationReason'])))
