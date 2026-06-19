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
  cpfCnpj: string   // CPF puro (apenas dígitos) — Asaas recebe em texto puro
  birthDate: string // YYYY-MM-DD
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
        events: [
          'ACCOUNT_STATUS_DOCUMENT_APPROVED',
          'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED',
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
  if (!res.ok) throw new Error(`ASAAS_TRANSFER_FAILED: ${JSON.stringify(res.data)}`)
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
  if (!res.ok) throw new Error(`ASAAS_CASHOUT_FAILED: ${JSON.stringify(res.data)}`)
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
