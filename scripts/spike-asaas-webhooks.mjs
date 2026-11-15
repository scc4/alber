// SPIKE (sandbox): quem recebe o webhook de uma cobrança da subconta com split para a mãe? Precisa de spike-webhook-sink publicada.
const KEY = process.env.ASAAS_SANDBOX_KEY ?? '', TOKEN = process.env.SINK_TOKEN ?? '', SINK = process.env.SINK_URL
if (!KEY.includes('hmlg') || !TOKEN || !SINK) { console.error('faltam ASAAS_SANDBOX_KEY (hmlg), SINK_TOKEN, SINK_URL'); process.exit(1) }
const BASE = 'https://sandbox.asaas.com/api/v3'
const call = async (m, p, k, b) => { for (let i = 0; i < 3; i++) { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', access_token: k, 'User-Agent': 'alber-spike' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t) } catch { if (m === 'GET') return t; await new Promise((s) => setTimeout(s, 4000)) } } return 'timeout' }
const wh = (src) => ({ name: 'spike-' + src, url: `${SINK}?src=${src}`, email: 'spike@example.com', sendType: 'SEQUENTIALLY', apiVersion: 3, enabled: true, interrupted: false, authToken: TOKEN, events: ['PAYMENT_CREATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_REFUNDED','PAYMENT_UPDATED','PAYMENT_SPLIT_CANCELLED','PAYMENT_SPLIT_DIVERGENCE_BLOCK','PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED'] })
const today = new Date().toISOString().slice(0, 10)
const parentWallet = (await call('GET', '/wallets/', KEY)).data[0].id
const pw = await call('POST', '/webhooks', KEY, wh('parent')); console.log('webhook mãe', pw.id ?? pw)
const acc = await call('POST', '/accounts', KEY, { name: 'Restaurante SpikeWH', email: `spikewh+${Date.now()}@example.com`, cpfCnpj: process.env.SPIKE_CNPJ, companyType: 'LIMITED', mobilePhone: '11987654321', incomeValue: 10000, address: 'Av Paulista', addressNumber: '1000', province: 'Bela Vista', postalCode: '01310100', webhooks: [wh('sub')] })
console.log('subconta', acc.id ?? acc, 'webhooks na criação:', acc.webhooks?.length)
const K = acc.apiKey, sub = (m, p, b) => call(m, p, K, b)
console.log('webhooks da subconta', JSON.stringify((await sub('GET', '/webhooks')).data?.map((w) => ({ name: w.name, enabled: w.enabled }))))
const cust = (await sub('POST', '/customers', { name: 'Cliente Teste', cpfCnpj: '24971563792', notificationDisabled: true })).id
const pay = await sub('POST', '/payments', { customer: cust, billingType: 'CREDIT_CARD', value: 20, dueDate: today, externalReference: 'food_spike_' + Date.now(), split: [{ walletId: parentWallet, fixedValue: 1.99 }] })
console.log('cobrança', pay.id ?? pay)
console.log('pago', (await sub('POST', `/payments/${pay.id}/payWithCreditCard`, { creditCard: { holderName: 'TESTE', number: '5162306219378829', expiryMonth: '12', expiryYear: '2030', ccv: '318' }, creditCardHolderInfo: { name: 'Teste', email: 'spike@example.com', cpfCnpj: '24971563792', postalCode: '01310100', addressNumber: '1000', phone: '11987654321' }, remoteIp: '127.0.0.1' })).status)
await new Promise((s) => setTimeout(s, 60000))
for (let i = 0; i < 4; i++) { const r = await sub('POST', `/payments/${pay.id}/refund`, { value: 20, description: 'spike' }); console.log('estorno', r.status ?? r.errors?.[0]?.description); if (r.status) break; await new Promise((s) => setTimeout(s, 30000)) }
await new Promise((s) => setTimeout(s, 30000))
console.log('PAYMENT', pay.id)
await call('DELETE', `/webhooks/${pw.id}`, KEY); console.log('webhook da mãe removido')
