// Cobrança de pedido de take away do Alber Food (Pix ou cartão, com split para a empresa do restaurante).
// POST /takeaway-payment-create
//   { company_id, external_reference: 'food_<uuid>', amount_cents, fee_total_cents, method: 'pix'|'credit_card',
//     customer: { name, phone? }, description, expires_at }
//   -> { payment_id, pix_payload?, invoice_url?, expires_at }
//
// Só o Alber Food chama (x-alber-food-key). O cliente do restaurante é anônimo. A cobrança nasce na conta PAI com
// split: a carteira da empresa recebe `amount - fee_total` e o resto (taxa Alber + gateway) fica na conta pai.
// Nunca devolve chave nem wallet. Repetir a chamada com a mesma referência devolve a cobrança já criada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { requireFoodKey, UUID, FOOD_REFERENCE, toReais } from '../_shared/food-service.ts'
import {
  createTakeawayCustomer, createTakeawayPayment, findPaymentByReference, getPixQrCode, AsaasError,
} from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

/** Valores aceitos (centavos): o mínimo da cobrança no Asaas e um teto de segurança igual ao do Alber Food. */
const MIN_CENTS = 500
const MAX_CENTS = 500_000

interface CreateBody {
  company_id?: unknown
  external_reference?: unknown
  amount_cents?: unknown
  fee_total_cents?: unknown
  method?: unknown
  customer?: { name?: unknown; phone?: unknown }
  description?: unknown
  expires_at?: unknown
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Hoje no fuso de Brasília (dueDate do Asaas é uma data, não um instante). */
function todayBr(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const denied = requireFoodKey(req)
  if (denied) return denied

  let body: CreateBody
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const companyId = typeof body.company_id === 'string' ? body.company_id : ''
  const reference = typeof body.external_reference === 'string' ? body.external_reference : ''
  const method = body.method
  const name = typeof body.customer?.name === 'string' ? body.customer.name.trim() : ''
  const phoneDigits = typeof body.customer?.phone === 'string' ? body.customer.phone.replace(/\D/g, '') : ''
  const expiresAt = typeof body.expires_at === 'string' ? new Date(body.expires_at) : null
  if (!UUID.test(companyId)) return err('INVALID_COMPANY', 'company_id inválido', 422)
  if (!FOOD_REFERENCE.test(reference)) return err('INVALID_REFERENCE', 'external_reference inválida', 422)
  if (method !== 'pix' && method !== 'credit_card') return err('INVALID_METHOD', 'method inválido', 422)
  if (!isInt(body.amount_cents) || body.amount_cents < MIN_CENTS || body.amount_cents > MAX_CENTS) return err('INVALID_AMOUNT', 'amount_cents fora do limite', 422)
  // A taxa precisa deixar algo para o restaurante: sem isso o split não existe.
  if (!isInt(body.fee_total_cents) || body.fee_total_cents < 0 || body.fee_total_cents >= body.amount_cents) return err('INVALID_FEE', 'fee_total_cents inválido', 422)
  if (name.length < 2 || name.length > 60) return err('INVALID_CUSTOMER', 'customer.name inválido', 422)
  if (phoneDigits && !/^\d{10,11}$/.test(phoneDigits)) return err('INVALID_CUSTOMER', 'customer.phone inválido', 422)
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return err('INVALID_EXPIRY', 'expires_at inválido', 422)
  const description = (typeof body.description === 'string' ? body.description : 'Pedido Alber Food').slice(0, 120)

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const parentKey = Deno.env.get('ASAAS_API_KEY')
  if (!parentKey) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)

  // A empresa precisa existir, estar viva, ter o KYC aprovado e a carteira definida.
  const { data: company, error: companyErr } = await supabaseAdmin
    .from('companies')
    .select('id, asaas_wallet_id, kyc_status, account_status, deleted_at')
    .eq('id', companyId)
    .maybeSingle()
  if (companyErr) return err('DB_ERROR', 'Erro ao consultar a empresa', 503)
  const c = company as { id: string; asaas_wallet_id: string | null; kyc_status: string; account_status: string; deleted_at: string | null } | null
  if (!c || c.deleted_at) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)
  if (c.kyc_status !== 'approved' || c.account_status === 'blocked' || !c.asaas_wallet_id) return err('COMPANY_NOT_APPROVED', 'Empresa sem conta aprovada', 409)

  const restaurantCents = body.amount_cents - body.fee_total_cents
  try {
    // Repetição depois de um timeout: devolve a cobrança que já existe em vez de criar outra.
    let existing = await findPaymentByReference(reference, parentKey)
    let paymentId: string
    let invoiceUrl: string | null
    if (existing) {
      paymentId = existing.id
      invoiceUrl = existing.invoiceUrl
    } else {
      const customer = await createTakeawayCustomer(name, phoneDigits || null, parentKey)
      const created = await createTakeawayPayment(
        {
          customer,
          billingType: method === 'pix' ? 'PIX' : 'CREDIT_CARD',
          value: toReais(body.amount_cents),
          dueDate: todayBr(),
          description,
          externalReference: reference,
          split: [{ walletId: c.asaas_wallet_id, fixedValue: toReais(restaurantCents) }],
        },
        parentKey,
      )
      paymentId = created.id
      invoiceUrl = created.invoiceUrl
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: null,
      event_type: 'takeaway_payment_created',
      metadata: { company_id: c.id, reference, amount_cents: body.amount_cents, fee_total_cents: body.fee_total_cents, method, repeated: Boolean(existing) },
    })

    if (method === 'pix') {
      const qr = await getPixQrCode(paymentId, parentKey)
      return json({ payment_id: paymentId, pix_payload: qr.payload, expires_at: expiresAt.toISOString() }, 201)
    }
    return json({ payment_id: paymentId, invoice_url: invoiceUrl, expires_at: expiresAt.toISOString() }, 201)
  } catch (e) {
    await logError(supabaseAdmin, 'takeaway-payment-create', e, { reference })
    if (e instanceof AsaasError) return err('PAYMENT_PROVIDER_ERROR', 'O Asaas recusou a cobrança', 502)
    return err('PAYMENT_PROVIDER_ERROR', 'Falha ao criar a cobrança', 502)
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
