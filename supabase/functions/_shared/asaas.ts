// Spec: /specs/04_api_asaas.md
// NUNCA chamar Asaas diretamente do app — somente via BFF (spec §1)

const SANDBOX_URL    = 'https://sandbox.asaas.com/api/v3'
const PRODUCTION_URL = 'https://api.asaas.com/api/v3'

function baseUrl(): string {
  return Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
    ? PRODUCTION_URL
    : SANDBOX_URL
}

export class AsaasError extends Error {
  readonly code: string
  readonly asaasResponse: Record<string, unknown>
  constructor(code: string, response: Record<string, unknown>) {
    super(`${code}: ${JSON.stringify(response)}`)
    this.name = 'AsaasError'
    this.code = code
    this.asaasResponse = response
  }
}

async function asaasRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${baseUrl()}${path}`
  console.log(`[asaas] ${method} ${url}`)
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'access_token': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('[asaas] status:', res.status)
    console.error('[asaas] body:', JSON.stringify(data))
  }
  return { ok: res.ok, status: res.status, data }
}

// ── Subconta (spec 04_api §4.1) ───────────────────────────────────────────────

export interface CreateAccountInput {
  name: string
  email: string
  cpfCnpj: string   // CPF ou CNPJ puro (apenas dígitos) — Asaas recebe em texto puro
  birthDate?: string // YYYY-MM-DD — obrigatório quando pessoa física (11 dígitos)
  companyType?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION' // obrigatório quando pessoa jurídica (14 dígitos)
  tradingName?: string // nome fantasia — só pessoa jurídica, opcional
  phone: string
  mobilePhone: string
  address: string
  addressNumber: string
  complement?: string
  province: string  // bairro
  postalCode: string
  webhookUrl: string      // URL do webhook de KYC
  pixWebhookUrl: string   // URL do webhook de pagamentos Pix
  webhookSecret: string
  incomeValue?: number
}

export async function createAsaasAccount(
  input: CreateAccountInput,
  parentApiKey: string,
): Promise<{ id: string; apiKey: string; walletId: string }> {
  // O Asaas decide personType (FISICA/JURIDICA) pelo tamanho do cpfCnpj —
  // 11 dígitos = CPF/pessoa física, 14 dígitos = CNPJ/pessoa jurídica.
  const isJuridica = input.cpfCnpj.replace(/\D/g, '').length === 14

  if (isJuridica && !input.companyType) {
    throw new Error('ASAAS_ACCOUNT_CREATE_FAILED: companyType é obrigatório para pessoa jurídica')
  }
  if (!isJuridica && !input.birthDate) {
    throw new Error('ASAAS_ACCOUNT_CREATE_FAILED: birthDate é obrigatório para pessoa física')
  }

  const res = await asaasRequest('POST', '/accounts', parentApiKey, {
    name:          input.name,
    email:         input.email,
    cpfCnpj:       input.cpfCnpj,
    ...(isJuridica
      ? { companyType: input.companyType, tradingName: input.tradingName }
      : { birthDate: input.birthDate }),
    phone:         input.phone,
    mobilePhone:   input.mobilePhone,
    address:       input.address,
    addressNumber: input.addressNumber,
    complement:    input.complement ?? '',
    province:      input.province,
    postalCode:    input.postalCode,
    incomeValue:   input.incomeValue,
    webhooks: [
      {
        name:        'Alber KYC Webhook',
        url:         input.webhookUrl,
        email:       'webhook@usealber.com',
        sendType:    'SEQUENTIALLY',
        apiVersion:  3,
        enabled:     true,
        interrupted: false,
        authToken:   input.webhookSecret,
        // A aprovação final é a família ACCOUNT_STATUS_GENERAL_APPROVAL_* (docs.asaas.com/docs/account-status-events).
        events: [
          'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
          'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
        ],
      },
      {
        name:        'Alber Pix Webhook',
        url:         input.pixWebhookUrl,
        email:       'webhook@usealber.com',
        sendType:    'SEQUENTIALLY',
        apiVersion:  3,
        enabled:     true,
        interrupted: false,
        authToken:   input.webhookSecret,
        events: [
          'PAYMENT_CONFIRMED',
          'PAYMENT_RECEIVED',
          'PAYMENT_REFUNDED',
          'TRANSFER_DONE',
          'TRANSFER_FAILED',
        ],
      },
    ],
  })

  if (!res.ok) {
    throw new Error(`ASAAS_ACCOUNT_CREATE_FAILED: ${JSON.stringify(res.data)}`)
  }

  console.log('[asaas] full account response:', JSON.stringify(res.data))
  const d = res.data as Record<string, unknown>
  const apiKey = (d.apiKey ?? d.accessToken ?? d.walletKey ?? null) as string | null
  return { id: d.id as string, apiKey: apiKey as string, walletId: d.walletId as string }
}

// ── Recuperar subconta existente por CPF (idempotência) ──────────────────────

export async function getAsaasAccountByCpf(
  cpfCnpj: string,
  parentApiKey: string,
): Promise<{ id: string; apiKey: string; walletId: string } | null> {
  const res = await asaasRequest('GET', `/accounts?cpfCnpj=${cpfCnpj}&limit=1`, parentApiKey)
  if (!res.ok) {
    console.error('[asaas] getAsaasAccountByCpf failed:', res.status, JSON.stringify(res.data))
    return null
  }
  console.log('[asaas] full getAsaasAccountByCpf response:', JSON.stringify(res.data))
  const list = (res.data as { data?: Record<string, unknown>[] }).data
  if (!list?.[0]) return null
  const d = list[0]
  const apiKey = (d.apiKey ?? d.accessToken ?? d.walletKey ?? null) as string | null
  return { id: d.id as string, apiKey: apiKey as string, walletId: d.walletId as string }
}

// ── PIX QR Code (spec 04_api §4.2) ───────────────────────────────────────────

export interface CreatePixPaymentInput {
  customer: string          // Asaas customer ID (obter via GET /customers)
  value: number
  dueDate: string           // YYYY-MM-DD (hoje + PIX_EXPIRATION_MINUTES)
  externalReference: string // transaction_id para idempotência
}

export async function createPixPayment(
  input: CreatePixPaymentInput,
  subcontaApiKey: string,
): Promise<{ id: string }> {
  const res = await asaasRequest('POST', '/payments', subcontaApiKey, {
    customer:          input.customer,
    billingType:       'PIX',
    value:             input.value,
    dueDate:           input.dueDate,
    description:       'Carregamento Alber',
    externalReference: input.externalReference,
  })

  if (!res.ok) throw new Error(`ASAAS_PAYMENT_CREATE_FAILED: ${JSON.stringify(res.data)}`)
  return { id: (res.data as { id: string }).id }
}

export async function getPixQrCode(
  paymentId: string,
  subcontaApiKey: string,
): Promise<{ encodedImage: string; payload: string; expirationDate: string }> {
  const res = await asaasRequest('GET', `/payments/${paymentId}/pixQrCode`, subcontaApiKey)
  if (!res.ok) throw new Error(`ASAAS_QRCODE_FAILED: ${JSON.stringify(res.data)}`)
  return res.data as { encodedImage: string; payload: string; expirationDate: string }
}

// ── Saldo da subconta (spec 04_api §4.8) ─────────────────────────────────────

export async function getSubcontaBalance(subcontaApiKey: string): Promise<number> {
  const res = await asaasRequest('GET', '/finance/balance', subcontaApiKey)
  if (!res.ok) throw new Error(`ASAAS_BALANCE_FAILED`)
  return (res.data as { balance: number }).balance
}

// ── Customer (necessário para criar pagamentos) ───────────────────────────────
// No modelo Asaas, o campo `customer` em /payments é quem vai pagar o QR.
// Para carregar (self-load), o customer é o próprio usuário na sua subconta.

export async function ensureAsaasCustomer(
  subcontaApiKey: string,
  name: string,
  email: string,
): Promise<string> {
  // Tenta encontrar customer existente pelo email
  const search = await asaasRequest(
    'GET',
    `/customers?email=${encodeURIComponent(email)}&limit=1`,
    subcontaApiKey,
  )
  const existing = (search.data as { data?: { id: string }[] })?.data?.[0]
  if (existing?.id) return existing.id

  // Cria novo customer
  const res = await asaasRequest('POST', '/customers', subcontaApiKey, { name, email })
  if (!res.ok) throw new Error(`ASAAS_CUSTOMER_CREATE_FAILED: ${JSON.stringify(res.data)}`)
  return (res.data as { id: string }).id
}

// ── Transferência inter-subconta (spec 04_api §4.4) ──────────────────────────
// Usado em: receber (pagador→recebedor), receber (pagador→pai/taxa),
//           transferir (remetente→destinatário)

export async function transferToWallet(
  value: number,
  walletId: string,
  description: string,
  externalReference: string,
  fromApiKey: string,
): Promise<{ id: string; status: string }> {
  const res = await asaasRequest('POST', '/transfers', fromApiKey, {
    value,
    walletId,
    description,
    externalReference,
  })
  if (!res.ok) throw new AsaasError('ASAAS_TRANSFER_FAILED', res.data as Record<string, unknown>)
  const d = res.data as { id: string; status: string }
  return { id: d.id, status: d.status }
}

// ── Cash out via Pix externo (spec 04_api §4.5) ───────────────────────────────
// Usado em: descarregar

export async function cashoutPix(
  value: number,
  pixAddressKey: string,
  pixAddressKeyType: string,
  externalReference: string,
  fromApiKey: string,
): Promise<{ id: string; status: string }> {
  const res = await asaasRequest('POST', '/transfers', fromApiKey, {
    value,
    pixAddressKey,
    pixAddressKeyType,
    description: 'Descarregamento Alber',
    externalReference,
  })
  if (!res.ok) throw new AsaasError('ASAAS_CASHOUT_FAILED', res.data as Record<string, unknown>)
  const d = res.data as { id: string; status: string }
  return { id: d.id, status: d.status }
}

// ── QR Code estático (spec 04_api §4.9) ──────────────────────────────────────
// format: "ALL" retorna encodedImage (PNG base64) + payload (BR Code).

export async function createPixStaticQrCode(
  addressKey: string,
  value: number,
  description: string,
  expirationSeconds: number,
  subcontaApiKey: string,
): Promise<{ id: string; encodedImage: string; payload: string }> {
  const res = await asaasRequest('POST', '/pix/qrCodes/static', subcontaApiKey, {
    addressKey,
    description,
    value,
    format: 'ALL',
    expirationSeconds,
  })
  if (!res.ok) throw new Error(`ASAAS_STATIC_QRCODE_FAILED: ${JSON.stringify(res.data)}`)
  const d = res.data as Record<string, unknown>
  return {
    id:           d.id as string,
    encodedImage: d.encodedImage as string,
    payload:      d.payload as string,
  }
}

// ── Chave Pix (spec 04_api §4.9) ─────────────────────────────────────────────

export async function createPixAddressKey(
  type: 'EVP' | 'CPF' | 'EMAIL' | 'PHONE',
  subcontaApiKey: string,
): Promise<{ key: string; type: string }> {
  const res = await asaasRequest('POST', '/pix/addressKeys', subcontaApiKey, { type })
  if (!res.ok) throw new Error(`ASAAS_PIX_KEY_FAILED: ${JSON.stringify(res.data)}`)
  const d = res.data as { key: string; type: string }
  return { key: d.key, type: d.type }
}

// ── Refund (spec 04_api §4.6) ────────────────────────────────────────────────

export async function refundPayment(
  paymentId: string,
  value: number,
  description: string,
  subcontaApiKey: string,
): Promise<void> {
  const res = await asaasRequest('POST', `/payments/${paymentId}/refund`, subcontaApiKey, {
    value, description,
  })
  if (!res.ok) throw new Error(`ASAAS_REFUND_FAILED: ${JSON.stringify(res.data)}`)
}

// ── Cobranças de take away do Alber Food (conta pai + split) ───────────────────
// A cobrança é criada na conta PAI, com o split para a carteira da empresa do restaurante: o Asaas liquida direto na
// carteira e o que sobra (taxa Alber + gateway) fica na conta pai. O cliente do restaurante é anônimo: o customer só
// leva nome e telefone. Quem chama é o Alber Food, por funções de serviço (takeaway-payment-*).

export async function createTakeawayCustomer(
  name: string,
  mobilePhone: string | null,
  parentApiKey: string,
): Promise<string> {
  const res = await asaasRequest('POST', '/customers', parentApiKey, {
    name,
    ...(mobilePhone ? { mobilePhone } : {}),
    notificationDisabled: true, // o aviso ao cliente é do Alber Food, não do Asaas
  })
  if (!res.ok) throw new AsaasError('ASAAS_CUSTOMER_CREATE_FAILED', res.data as Record<string, unknown>)
  return (res.data as { id: string }).id
}

export interface CreateTakeawayPaymentInput {
  customer: string
  billingType: 'PIX' | 'CREDIT_CARD'
  value: number            // em reais (2 casas)
  dueDate: string          // YYYY-MM-DD
  description: string
  externalReference: string
  split: { walletId: string; fixedValue: number }[]
}

export async function createTakeawayPayment(
  input: CreateTakeawayPaymentInput,
  parentApiKey: string,
): Promise<{ id: string; invoiceUrl: string | null }> {
  const res = await asaasRequest('POST', '/payments', parentApiKey, input)
  if (!res.ok) throw new AsaasError('ASAAS_PAYMENT_CREATE_FAILED', res.data as Record<string, unknown>)
  const d = res.data as { id: string; invoiceUrl?: string }
  return { id: d.id, invoiceUrl: d.invoiceUrl ?? null }
}

/** Cobrança já criada para esta referência (a chamada pode ser repetida depois de um timeout). */
export async function findPaymentByReference(
  externalReference: string,
  parentApiKey: string,
): Promise<{ id: string; status: string; invoiceUrl: string | null } | null> {
  const res = await asaasRequest('GET', `/payments?externalReference=${encodeURIComponent(externalReference)}&limit=1`, parentApiKey)
  if (!res.ok) return null
  const first = (res.data as { data?: { id: string; status: string; invoiceUrl?: string }[] }).data?.[0]
  return first ? { id: first.id, status: first.status, invoiceUrl: first.invoiceUrl ?? null } : null
}

export async function getPaymentWithRefunds(
  paymentId: string,
  parentApiKey: string,
): Promise<{ status: string; externalReference: string | null; refunds: { description?: string; value?: number }[] }> {
  const res = await asaasRequest('GET', `/payments/${paymentId}`, parentApiKey)
  if (!res.ok) throw new AsaasError('ASAAS_PAYMENT_GET_FAILED', res.data as Record<string, unknown>)
  const d = res.data as { status: string; externalReference?: string; refunds?: { description?: string; value?: number }[] }
  return { status: d.status, externalReference: d.externalReference ?? null, refunds: d.refunds ?? [] }
}

/** Cancela uma cobrança que ninguém pagou (Pix vencido). */
export async function cancelPayment(paymentId: string, parentApiKey: string): Promise<void> {
  const res = await asaasRequest('DELETE', `/payments/${paymentId}`, parentApiKey)
  if (!res.ok) throw new AsaasError('ASAAS_PAYMENT_CANCEL_FAILED', res.data as Record<string, unknown>)
}

// ── Situação cadastral da conta (KYC) ─────────────────────────────────────────
// GET /myAccount/status devolve commercialInfo, bankAccountInfo, documentation e general
// (PENDING | AWAITING_APPROVAL | APPROVED | REJECTED). `general` é a aprovação final.
// A documentação recomenda os webhooks, mas a consulta cobre o webhook perdido e o sandbox.

export async function getAccountGeneralStatus(apiKey: string): Promise<string | null> {
  const res = await asaasRequest('GET', '/myAccount/status', apiKey)
  if (!res.ok) return null
  const general = (res.data as { general?: unknown }).general
  return typeof general === 'string' ? general : null
}

// ── Conta pai: saldo, a receber e extrato (somente leitura, para o Alber Admin) ───────────────────────────────

const toCents = (reais: unknown): number => (typeof reais === 'number' && Number.isFinite(reais) ? Math.round(reais * 100) : 0)

export async function getParentBalanceCents(parentApiKey: string): Promise<number> {
  const res = await asaasRequest('GET', '/finance/balance', parentApiKey)
  const balance = (res.data as { balance?: unknown }).balance
  if (!res.ok || typeof balance !== 'number') throw new AsaasError('ASAAS_BALANCE_FAILED', res.data as Record<string, unknown>)
  return toCents(balance)
}

/** Cobranças ainda a receber (PENDING). Não é essencial: se o Asaas recusar, devolve null e o saldo segue. */
export async function getPendingStatistics(parentApiKey: string): Promise<{ quantity: number; value_cents: number; net_cents: number } | null> {
  const res = await asaasRequest('GET', '/finance/payment/statistics?status=PENDING', parentApiKey)
  if (!res.ok) return null
  const d = res.data as { quantity?: unknown; value?: unknown; netValue?: unknown }
  return { quantity: typeof d.quantity === 'number' ? d.quantity : 0, value_cents: toCents(d.value), net_cents: toCents(d.netValue) }
}

export interface ParentMovement {
  id: string
  type: string
  value_cents: number
  balance_cents: number | null
  date: string | null
  linked: boolean
}

/**
 * Extrato recente. Só id, tipo, valor, saldo e data saem daqui: a `description` do Asaas costuma trazer o nome do cliente
 * e nunca é repassada. `linked` diz só que o lançamento tem uma cobrança, transferência ou conta de origem.
 */
export async function listParentMovements(parentApiKey: string, limit = 30): Promise<ParentMovement[]> {
  const res = await asaasRequest('GET', `/financialTransactions?offset=0&limit=${Math.min(Math.max(limit, 1), 50)}`, parentApiKey)
  if (!res.ok) throw new AsaasError('ASAAS_STATEMENT_FAILED', res.data as Record<string, unknown>)
  const data = (res.data as { data?: unknown }).data
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  return list.slice(0, 50).map((e) => ({
    id: String(e.id ?? '').slice(0, 64),
    type: String(e.type ?? 'UNKNOWN').slice(0, 40),
    value_cents: toCents(e.value),
    balance_cents: typeof e.balance === 'number' ? toCents(e.balance) : null,
    date: typeof e.date === 'string' ? e.date.slice(0, 10) : null,
    linked: Boolean(e.paymentId || e.transferId || e.anticipationId || e.billId || e.invoiceId),
  }))
}
