// SPIKE DESCARTÁVEL — cobrança na SUBCONTA com split para a conta-mãe. SÓ SANDBOX.
// Uso: ASAAS_SANDBOX_KEY='$aact_hmlg_...' node scripts/spike-asaas-subconta-cobranca.mjs
// Não imprime chaves nem dados pessoais. Saída: JSON de cada passo (campos relevantes).
const KEY = process.env.ASAAS_SANDBOX_KEY ?? ''
if (!KEY.includes('hmlg')) { console.error('Recuso: a chave não parece de SANDBOX ($aact_hmlg_...).'); process.exit(1) }
const BASE = 'https://sandbox.asaas.com/api/v3'
const UA = 'alber-spike'
async function call(method, path, key, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', access_token: key, 'User-Agent': UA }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
const show = (t, v) => console.log(`\n## ${t}\n` + JSON.stringify(v, null, 2))
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => k in (o ?? {})).map((k) => [k, o[k]]))
const today = new Date().toISOString().slice(0, 10)

// 0. conta-mãe: walletId
const parent = await call('GET', '/wallets/', KEY); show('wallets (mãe)', parent.status)
const parentWallet = parent.data?.data?.[0]?.id ?? (await call('GET', '/myAccount/accountNumber', KEY)).data?.walletId
// 1. subconta de teste (CNPJ de teste gerado; e-mail único)
const n = Date.now()
const cnpj = process.env.SPIKE_CNPJ // informe um CNPJ válido de teste
if (!cnpj) { console.error('Defina SPIKE_CNPJ (CNPJ válido, só dígitos) para criar a subconta.'); process.exit(1) }
const acc = await call('POST', '/accounts', KEY, {
  name: 'Restaurante Spike ' + n, email: `spike+${n}@example.com`, cpfCnpj: cnpj, companyType: 'LIMITED', mobilePhone: '11987654321',
  incomeValue: 10000, address: 'Av Paulista', addressNumber: '1000', province: 'Bela Vista', postalCode: '01310100',
})
show('subconta criada', pick(acc.data, ['id', 'walletId', 'name', 'errors']))
if (!acc.data.apiKey) { console.error('subconta falhou'); process.exit(1) }
const subKey = acc.data.apiKey, subWallet = acc.data.walletId
const sub = (m, p, b) => call(m, p, subKey, b)
const cust = await sub('POST', '/customers', { name: 'Cliente Teste', cpfCnpj: '24971563792', notificationDisabled: true })
const custNoDoc = await sub('POST', '/customers', { name: 'Cliente Sem Doc', notificationDisabled: true })
show('customer sem CPF', pick(custNoDoc.data, ['id', 'errors']))

const mk = (customer, billingType, split, extra = {}) => sub('POST', '/payments', {
  customer, billingType, value: 20, dueDate: today, description: 'Pedido spike', externalReference: 'food_spike_' + n + billingType, split, ...extra,
})
// 2. Pix na subconta com split fixo e percentual
for (const [label, split] of [['fixo', [{ walletId: parentWallet, fixedValue: 1.99 }]], ['percentual', [{ walletId: parentWallet, percentualValue: 10 }]]]) {
  const p = await mk(cust.data.id, 'PIX', split)
  show(`Pix na subconta, split ${label}`, pick(p.data, ['id', 'status', 'value', 'netValue', 'split', 'invoiceUrl', 'errors']))
  if (p.data.id && label === 'fixo') {
    const qr = await sub('GET', `/payments/${p.data.id}/pixQrCode`); show('pixQrCode (campos)', Object.keys(qr.data ?? {}))
    globalThis.pixId = p.data.id
  }
}
const pNoDoc = await mk(custNoDoc.data.id, 'PIX', [{ walletId: parentWallet, fixedValue: 1.99 }]); show('Pix com cliente sem CPF', pick(pNoDoc.data, ['id', 'errors']))
// 3. Cartão (fatura) com callback
const card = await mk(cust.data.id, 'CREDIT_CARD', [{ walletId: parentWallet, fixedValue: 1.99 }], { callback: { successUrl: 'https://example.com/pedido/ok', autoRedirect: true } })
show('Cartão na subconta (+callback)', pick(card.data, ['id', 'status', 'invoiceUrl', 'callback', 'errors']))
if (card.data.invoiceUrl) { const h = await fetch(card.data.invoiceUrl, { headers: { 'User-Agent': UA } }); const t = await h.text(); show('fatura (trechos)', t.match(/(responsabilidade|respons[aá]vel|ALBER|Spike)[^<]{0,120}/gi)?.slice(0, 8)) }
// 4. Simular pagamento (sandbox) e estorno
if (globalThis.pixId) {
  const pay = await sub('POST', `/payments/${globalThis.pixId}/receiveInCash`, { paymentDate: today, value: 20 }); show('receiveInCash', pick(pay.data, ['status', 'errors']))
}
// Tokenização: cartão sem fatura
const tok = await sub('POST', '/creditCard/tokenizeCreditCard', { customer: cust.data.id, creditCard: { holderName: 'TESTE', number: '5162306219378829', expiryMonth: '12', expiryYear: '2030', ccv: '318' }, creditCardHolderInfo: { name: 'Teste', email: 'spike@example.com', cpfCnpj: '24971563792', postalCode: '01310100', addressNumber: '1000', phone: '11999999999' }, remoteIp: '127.0.0.1' })
show('tokenizeCreditCard', pick(tok.data, ['creditCardToken', 'errors']))
console.log('\nsubWallet/parentWallet definidos:', Boolean(subWallet), Boolean(parentWallet))
