// Spec: /specs/03_backend.md §4.3
// Spec: /specs/04_api_asaas.md §4.2, §3 (período de avaliação)
// Fluxo: pending TX → ensureCustomer → createPixPayment → getPixQrCode → update TX

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../../_shared/cors.ts'
import { aesDecrypt } from '../../_shared/crypto.ts'
import {
  ensureAsaasCustomer,
  createPixPayment,
  getPixQrCode,
} from '../../_shared/asaas.ts'

interface CarregarRequest {
  amount_albers: number
}

const EVALUATION_LIMIT_BRL = 2000
const EVALUATION_DAYS      = 60

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Autenticar JWT ───────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return err('UNAUTHORIZED', 'Token não fornecido', 401)
  }

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) {
    return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)
  }

  // ── Parse body ───────────────────────────────────────────────────────────────

  let body: CarregarRequest
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { amount_albers } = body

  if (!amount_albers || typeof amount_albers !== 'number' || amount_albers <= 0) {
    return err('INVALID_AMOUNT', 'Valor inválido', 400)
  }

  // Paridade 1:1 Alber → R$ (spec 04_api §5)
  const amountBrl = amount_albers

  // ── Buscar dados do usuário ──────────────────────────────────────────────────

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: userData, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, name, email, asaas_api_key_enc, kyc_status, account_status, created_at')
    .eq('auth_id', user.id)
    .maybeSingle()

  if (userErr || !userData) {
    return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  }

  // ── Verificar KYC (spec 03_backend §4.3) ────────────────────────────────────

  if (userData.kyc_status !== 'approved') {
    return err('KYC_REQUIRED', 'KYC não aprovado', 403)
  }

  // ── Verificar limite do período de avaliação (spec 04_api §3) ────────────────

  if (userData.account_status === 'evaluation') {
    const since = new Date(
      new Date(userData.created_at).getTime() - EVALUATION_DAYS * 24 * 60 * 60 * 1000,
    )
    // Conta total carregado nos últimos 60 dias com status completed
    const { data: evalTxs, error: evalErr } = await supabaseAdmin
      .from('transactions')
      .select('amount_brl')
      .eq('user_id', userData.id)
      .eq('type', 'carregar')
      .eq('status', 'completed')
      .gte('created_at', since.toISOString())

    if (evalErr) {
      console.error('Evaluation limit query failed:', evalErr)
      return err('DB_ERROR', 'Erro ao verificar limite', 500)
    }

    const totalCarregado = (evalTxs ?? []).reduce(
      (sum, tx) => sum + Number(tx.amount_brl ?? 0),
      0,
    )

    if (totalCarregado + amountBrl > EVALUATION_LIMIT_BRL) {
      return err(
        'EVALUATION_LIMIT',
        `Limite de R$ ${EVALUATION_LIMIT_BRL} para período de avaliação atingido`,
        422,
      )
    }
  }

  // ── Descriptografar API key da subconta ──────────────────────────────────────

  if (!userData.asaas_api_key_enc) {
    return err('ACCOUNT_NOT_CONFIGURED', 'Subconta financeira não configurada', 503)
  }

  let subApiKey: string
  try {
    const encSecret = Deno.env.get('ASAAS_API_KEY')!
    subApiKey       = await aesDecrypt(userData.asaas_api_key_enc, encSecret)
  } catch (e) {
    console.error('API key decryption failed:', e)
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // ── Criar transação com status 'pending' (idempotência — spec 04_api §6) ─────

  const { data: txData, error: txErr } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:    userData.id,
      type:       'carregar',
      amount:     amount_albers,
      amount_brl: amountBrl,
      fee_amount: 0,
      status:     'pending',
    })
    .select('id')
    .single()

  if (txErr || !txData) {
    console.error('Transaction insert failed:', txErr)
    return err('DB_ERROR', 'Erro ao registrar transação', 500)
  }

  const transactionId = txData.id

  // ── Obter ou criar customer Asaas (spec 04_api §4.2) ────────────────────────

  let customerId: string
  try {
    customerId = await ensureAsaasCustomer(subApiKey, userData.name, userData.email)
  } catch (e) {
    console.error('Asaas customer failed:', e)
    // Marcar transação como failed antes de retornar
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'failed' })
      .eq('id', transactionId)
    return err('ASAAS_ERROR', 'Erro ao acessar subconta financeira', 503)
  }

  // ── Criar cobrança PIX (spec 04_api §4.2) ───────────────────────────────────

  const pixExpirationMinutes = parseInt(Deno.env.get('PIX_EXPIRATION_MINUTES') ?? '30', 10)
  const dueDate = new Date(Date.now() + pixExpirationMinutes * 60 * 1000)
    .toISOString()
    .slice(0, 10) // YYYY-MM-DD

  let asaasPaymentId: string
  try {
    const payment = await createPixPayment(
      {
        customer:          customerId,
        value:             amountBrl,
        dueDate,
        externalReference: transactionId,
      },
      subApiKey,
    )
    asaasPaymentId = payment.id
  } catch (e) {
    console.error('Asaas payment creation failed:', e)
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'failed' })
      .eq('id', transactionId)
    return err('ASAAS_ERROR', 'Erro ao criar cobrança PIX', 503)
  }

  // ── Buscar QR Code ───────────────────────────────────────────────────────────

  let qrData: { encodedImage: string; payload: string; expirationDate: string }
  try {
    qrData = await getPixQrCode(asaasPaymentId, subApiKey)
  } catch (e) {
    console.error('Asaas QR code fetch failed:', e)
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'failed', asaas_payment_id: asaasPaymentId })
      .eq('id', transactionId)
    return err('ASAAS_ERROR', 'Erro ao gerar QR Code PIX', 503)
  }

  // ── Atualizar transação com asaas_payment_id ─────────────────────────────────

  const { error: updateErr } = await supabaseAdmin
    .from('transactions')
    .update({ asaas_payment_id: asaasPaymentId })
    .eq('id', transactionId)

  if (updateErr) {
    console.error('Transaction update failed:', updateErr)
    // Não bloqueia — o webhook vai processar a confirmação de qualquer forma
  }

  // ── Log de auditoria ─────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    userData.id,
    event_type: 'carregar_initiated',
    metadata:   { transaction_id: transactionId, amount_brl: amountBrl, asaas_payment_id: asaasPaymentId },
  })

  return json(
    {
      payment_id:    transactionId,
      qr_code:       qrData.payload,
      qr_code_image: qrData.encodedImage,
      expires_at:    qrData.expirationDate,
    },
    201,
  )
})
