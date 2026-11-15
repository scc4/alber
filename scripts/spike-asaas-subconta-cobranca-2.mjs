// SPIKE parte 2 (sandbox): QR Pix, fatura, cartão pago, taxa, estorno, webhooks. Mesmas variáveis da parte 1.
const KEY = process.env.ASAAS_SANDBOX_KEY ?? ''
if (!KEY.includes('hmlg')) { console.error('só sandbox'); process.exit(1) }
const BASE = 'https://sandbox.asaas.com/api/v3'
const call = async (m, p, k, b) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', access_token: k, 'User-Agent': 'alber-spike' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
const show = (t, v) => console.log(`\n## ${t}\n` + JSON.stringify(v, null, 1))
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => k in (o ?? {})).map((k) => [k, o[k]]))
const today = new Date().toISOString().slice(0, 10)
const parentWallet = (await call('GET', '/wallets/', KEY)).data[0].id
const acc = await call('POST', '/accounts', KEY, { name: 'Restaurante Spike2', email: `spike2+${Date.now()}@example.com`, cpfCnpj: process.env.SPIKE_CNPJ, companyType: 'LIMITED', mobilePhone: '11987654321', incomeValue: 10000, address: 'Av Paulista', addressNumber: '1000', province: 'Bela Vista', postalCode: '01310100' })
const K = acc.apiKey; const sub = (m, p, b) => call(m, p, K, b)
show('conta', pick(acc, ['id', 'walletId']))
const cust = (await sub('POST', '/customers', { name: 'Cliente Teste', cpfCnpj: '24971563792', notificationDisabled: true })).id
const split = [{ walletId: parentWallet, fixedValue: 1.99 }]
const pix = await sub('POST', '/payments', { customer: cust, billingType: 'PIX', value: 20, dueDate: today, split })
show('pixQrCode erro', await sub('GET', `/payments/${pix.id}/pixQrCode`))
show('chaves pix da subconta', await sub('GET', '/pix/addressKeys'))
show('criar chave evp', await sub('POST', '/pix/addressKeys', { type: 'EVP' }))
show('pixQrCode depois da chave', pick(await sub('GET', `/payments/${pix.id}/pixQrCode`), ['payload', 'expirationDate', 'errors']))
show('webhooks da subconta', (await sub('GET', '/webhooks')).data)
show('myAccount/commercialInfo', pick(await sub('GET', '/myAccount/commercialInfo'), ['personType', 'companyName', 'tradingName', 'website', 'errors']))
// fatura do cartão (sem callback) e pagamento por API
const card = await sub('POST', '/payments', { customer: cust, billingType: 'CREDIT_CARD', value: 20, dueDate: today, split })
show('cartão', pick(card, ['id', 'status', 'invoiceUrl', 'errors']))
const html = await (await fetch(card.invoiceUrl, { headers: { 'User-Agent': 'alber-spike' } })).text()
show('fatura: textos', [...new Set((html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter((s) => /respons|Spike|ALBER|Asaas|benefici|emitid/i.test(s))))].slice(0, 15))
const paid = await sub('POST', `/payments/${card.id}/payWithCreditCard`, { creditCard: { holderName: 'TESTE', number: '5162306219378829', expiryMonth: '12', expiryYear: '2030', ccv: '318' }, creditCardHolderInfo: { name: 'Teste', email: 'spike@example.com', cpfCnpj: '24971563792', postalCode: '01310100', addressNumber: '1000', phone: '11987654321' }, remoteIp: '127.0.0.1' })
show('payWithCreditCard', pick(paid, ['status', 'errors']))
const after = await sub('GET', `/payments/${card.id}`); show('cartão pago', pick(after, ['status', 'value', 'netValue', 'billingType', 'split']))
show('split visto pela mãe', (await call('GET', `/payments/${card.id}`, KEY)).errors ?? 'mãe vê a cobrança')
const ref = await sub('POST', `/payments/${card.id}/refund`, { value: 20, description: 'spike' }); show('estorno total', pick(ref, ['status', 'refunds', 'errors']))
const fin = await sub('GET', `/payments/${card.id}`); show('depois do estorno', pick(fin, ['status', 'value', 'netValue', 'split']))
show('split pós-estorno (mãe /payments/splits)', (await call('GET', `/payments/splits/paid?limit=3`, KEY)).data?.slice(0,3).map(s => pick(s, ['paymentId','status','totalValue','refusalReason'])))
show('extrato subconta', (await sub('GET', '/financialTransactions?limit=10')).data?.map((t) => pick(t, ['type', 'value', 'description'])))
show('extrato mãe', (await call('GET', '/financialTransactions?limit=10', KEY)).data?.map((t) => pick(t, ['type', 'value', 'description'])))
