// Spec: /specs/04_api_asaas.md
// NUNCA chamar Asaas diretamente do app — somente via BFF (spec §1)

const SANDBOX_URL    = 'https://sandbox.asaas.com/api/v3'
const PRODUCTION_URL = 'https://api.asaas.com/api/v3'

function baseUrl(): string {
  return Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
    ? PRODUCTION_URL
    : SANDBOX_URL
}

async function asaasRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'access_token': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// ── Subconta (spec 04_api §4.1) ───────────────────────────────────────────────

export interface CreateAccountInput {
  name: string
  email: string
  cpfCnpj: string   // CPF puro (apenas dígitos) — Asaas recebe em texto puro
  birthDate: string // YYYY-MM-DD
  phone: string
  mobilePhone: string
  address: string
  addressNumber: string
  complement?: string
  province: string  // bairro
  postalCode: string
  webhookUrl: string
  webhookSecret: string
}

export async function createAsaasAccount(
  input: CreateAccountInput,
  parentApiKey: string,
): Promise<{ id: string; apiKey: string; walletId: string }> {
  const res = await asaasRequest('POST', '/accounts', parentApiKey, {
    name:          input.name,
    email:         input.email,
    cpfCnpj:       input.cpfCnpj,
    birthDate:     input.birthDate,
    companyType:   'INDIVIDUAL',
    phone:         input.phone,
    mobilePhone:   input.mobilePhone,
    address:       input.address,
    addressNumber: input.addressNumber,
    complement:    input.complement ?? '',
    province:      input.province,
    postalCode:    input.postalCode,
    webhooks: [{
      url:        input.webhookUrl,
      email:      input.email,
      apiVersion: 'v3',
      enabled:    true,
      authToken:  input.webhookSecret,
      events: [
        'PAYMENT_CONFIRMED',
        'PAYMENT_RECEIVED',
        'PAYMENT_REFUNDED',
        'TRANSFER_CONFIRMED',
        'TRANSFER_FAILED',
      ],
    }],
  })

  if (!res.ok) {
    throw new Error(`ASAAS_ACCOUNT_CREATE_FAILED: ${JSON.stringify(res.data)}`)
  }

  const d = res.data as { id: string; apiKey: string; walletId: string }
  return { id: d.id, apiKey: d.apiKey, walletId: d.walletId }
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
