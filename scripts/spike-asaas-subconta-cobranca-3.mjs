// SPIKE parte 3 (sandbox): chave Pix da subconta, nome no QR, cartão pago, taxa e estorno.
const KEY = process.env.ASAAS_SANDBOX_KEY ?? ''
if (!KEY.includes('hmlg')) { console.error('só sandbox'); process.exit(1) }
const BASE = 'https://sandbox.asaas.com/api/v3'
const call = async (m, p, k, b) => { for (let i = 0; i < 3; i++) { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', access_token: k, 'User-Agent': 'alber-spike' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t) } catch { if (m === 'GET') return t; await new Promise((s) => setTimeout(s, 4000)) } } return 'timeout' }
const show = (t, v) => console.log(`\n## ${t}\n` + JSON.stringify(v, null, 1))
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => k in (o ?? {})).map((k) => [k, o[k]]))
const today = new Date().toISOString().slice(0, 10)
const parentWallet = (await call('GET', '/wallets/', KEY)).data[0].id
const acc = await call('POST', '/accounts', KEY, { name: 'Restaurante Spike3', email: `spike3+${Date.now()}@example.com`, cpfCnpj: process.env.SPIKE_CNPJ, companyType: 'LIMITED', mobilePhone: '11987654321', incomeValue: 10000, address: 'Av Paulista', addressNumber: '1000', province: 'Bela Vista', postalCode: '01310100' })
const K = acc.apiKey; const sub = (m, p, b) => call(m, p, K, b)
const cust = (await sub('POST', '/customers', { name: 'Cliente Teste', cpfCnpj: '24971563792', notificationDisabled: true })).id
const split = [{ walletId: parentWallet, fixedValue: 1.99 }]
for (let i = 0; i < 6; i++) { const r = await sub('POST', '/pix/addressKeys', { type: 'EVP' }); show('criar chave evp', pick(r, ['id','status','type','errors'])); if (r.id) break; await new Promise((s) => setTimeout(s, 20000)) }
show('chaves', (await sub('GET', '/pix/addressKeys')).data?.map((k) => pick(k, ['type', 'status'])))
const pix = await sub('POST', '/payments', { customer: cust, billingType: 'PIX', value: 20, dueDate: today, split })
const qr = await sub('GET', `/payments/${pix.id}/pixQrCode`)
const pl = qr.payload ?? ''; const tag = (s, t) => { let i = 0; while (i < s.length) { const id = s.slice(i, i + 2), n = +s.slice(i + 2, i + 4); if (id === t) return s.slice(i + 4, i + 4 + n); i += 4 + n } }
show('QR Pix', { erro: qr.errors, nomeRecebedorEMV59: tag(pl, '59'), cidade60: tag(pl, '60'), expira: qr.expirationDate })
const card = await sub('POST', '/payments', { customer: cust, billingType: 'CREDIT_CARD', value: 20, dueDate: today, split })
const body = { creditCard: { holderName: 'TESTE', number: '5162306219378829', expiryMonth: '12', expiryYear: '2030', ccv: '318' }, creditCardHolderInfo: { name: 'Teste', email: 'spike@example.com', cpfCnpj: '24971563792', postalCode: '01310100', addressNumber: '1000', phone: '11987654321' }, remoteIp: '127.0.0.1' }
show('payWithCreditCard', pick(await sub('POST', `/payments/${card.id}/payWithCreditCard`, body), ['status', 'errors']))
const p = await sub('GET', `/payments/${card.id}`); show('cartão', pick(p, ['status', 'value', 'netValue']))
{ const m = await call('GET', `/payments/${card.id}`, KEY); show('mãe vê a cobrança da subconta?', m.split ? 'sim' : m) }
show('estorno', pick(await sub('POST', `/payments/${card.id}/refund`, { value: 20, description: 'spike' }), ['status', 'errors']))
const f = await sub('GET', `/payments/${card.id}`); show('pós-estorno', { status: f.status, split: f.split?.map((s) => pick(s, ['status', 'totalValue', 'cancellationReason'])) })
show('extrato subconta', (await sub('GET', '/financialTransactions?limit=10')).data?.map((t) => pick(t, ['type', 'value', 'description'])))
show('extrato mãe (topo)', (await call('GET', '/financialTransactions?limit=6', KEY)).data?.map((t) => pick(t, ['type', 'value', 'description'])))
