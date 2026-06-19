// Spec: /specs/03_backend.md §4.3
// Spec: /specs/04_api_asaas.md §4.2, §3 (período de avaliação)
// Fluxo: garantir pix_key → QR Code estático → pending TX

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt, aesEncrypt } from '../_shared/crypto.ts'
import { createPixAddressKey, createPixStaticQrCode } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

interface CarregarRequest {
  amount_albers: number
}

const EVALUATION_LIMIT_BRL = 2000
const EVALUATION_DAYS      = 60
const QR_EXPIRATION_SECS   = 1800  // 30 minutos

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

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

  const amountBrl = amount_albers  // paridade 1:1 Alber → R$

  // ── Buscar dados do usuário ──────────────────────────────────────────────────

  const { data: userData, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, asaas_api_key_enc, pix_key, kyc_status, account_status, created_at')
    .eq('auth_id', user.id)
    .maybeSingle()

  if (userErr || !userData) {
    return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  }

  // ── Verificar KYC ────────────────────────────────────────────────────────────

  if (userData.kyc_status !== 'approved') {
    return err('KYC_REQUIRED', 'KYC não aprovado', 403)
  }

  // ── Verificar limite do período de avaliação (spec 04_api §3) ────────────────

  if (userData.account_status === 'evaluation') {
    const since = new Date(
      new Date(userData.created_at).getTime() - EVALUATION_DAYS * 24 * 60 * 60 * 1000,
    )
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
      (sum, tx) => sum + Number(tx.amount_brl ?? 0), 0,
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

  const encSecret = Deno.env.get('ASAAS_API_KEY')!
  let subApiKey: string
  try {
    subApiKey = await aesDecrypt(userData.asaas_api_key_enc, encSecret)
  } catch (e) {
    console.error('API key decryption failed:', e)
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // ── ETAPA 1 — Garantir chave Pix ────────────────────────────────────────────

  let pixKeyRaw: string
  if (userData.pix_key) {
    try {
      pixKeyRaw = await aesDecrypt(userData.pix_key, encSecret)
    } catch (e) {
      console.error('pix_key decryption failed:', e)
      return err('CRYPTO_ERROR', 'Erro ao ler chave Pix', 500)
    }
  } else {
    // Cria EVP automaticamente — mesmo fluxo do webhook KYC
    try {
      const created   = await createPixAddressKey('EVP', subApiKey)
      pixKeyRaw       = created.key
      const encrypted = await aesEncrypt(pixKeyRaw, encSecret)
      await supabaseAdmin
        .from('users')
        .update({ pix_key: encrypted, pix_key_type: 'random' })
        .eq('id', userData.id)
      console.log(`[carregar] chave Pix EVP criada para usuário ${userData.id}`)
    } catch (e) {
      await logError(supabaseAdmin, 'financial-carregar', e, { user_id: userData.id, step: 'create_pix_key' })
      return err('PIX_KEY_FAILED', 'Erro ao configurar chave Pix', 503)
    }
  }

  // ── ETAPA 2 — Gerar QR Code estático ────────────────────────────────────────

  let qrCodeId:     string
  let encodedImage: string
  let qrPayload:    string
  try {
    const qr  = await createPixStaticQrCode(
      pixKeyRaw,
      amountBrl,
      'Carregar Albers',
      QR_EXPIRATION_SECS,
      subApiKey,
    )
    qrCodeId     = qr.id
    encodedImage = qr.encodedImage
    qrPayload    = qr.payload
    console.log(`[carregar] QR estático criado: ${qrCodeId}`)
  } catch (e) {
    await logError(supabaseAdmin, 'financial-carregar', e, { user_id: userData.id, step: 'create_qr' })
    return err('ASAAS_ERROR', 'Erro ao gerar QR Code PIX', 503)
  }

  // ── ETAPA 3 — Registrar transação pendente ───────────────────────────────────
  // asaas_payment_id guarda o qrCodeId para reconciliação no webhook PIX.

  const { data: txData, error: txErr } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id:          userData.id,
      type:             'carregar',
      amount:           amount_albers,
      amount_brl:       amountBrl,
      fee_amount:       0,
      status:           'pending',
      asaas_payment_id: qrCodeId,
    })
    .select('id')
    .single()

  if (txErr || !txData) {
    await logError(supabaseAdmin, 'financial-carregar', txErr, { user_id: userData.id, step: 'insert_tx' })
    return err('DB_ERROR', 'Erro ao registrar transação', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    userData.id,
    event_type: 'carregar_initiated',
    metadata:   { transaction_id: txData.id, amount_brl: amountBrl, qr_code_id: qrCodeId },
  })

  // ── ETAPA 4 — Retornar ao app ────────────────────────────────────────────────
  // Mantém campos da CarregarResponse que o app já consome.
  // qr_code_image: raw base64 — QRCodeDisplay adiciona o prefixo data:image/png;base64,

  const expiresAt = new Date(Date.now() + QR_EXPIRATION_SECS * 1000).toISOString()

  return json(
    {
      payment_id:         txData.id,
      qr_code:            qrPayload,
      qr_code_payload:    qrPayload,
      qr_code_image:      encodedImage,
      amount_albers,
      amount_brl:         amountBrl,
      expires_at:         expiresAt,
    },
    201,
  )
})
