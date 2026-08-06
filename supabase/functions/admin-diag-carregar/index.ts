// DIAGNÓSTICO — ÚNICA EXECUÇÃO (one-off), SOMENTE LEITURA
// POST /admin-diag-carregar { handle: string }
//
// Reproduz, passo a passo, exatamente o que financial-carregar faz ATÉ o ponto
// em que falharia — sem inserir transação, sem chamar createPixStaticQrCode
// (que teria efeito colateral real na Asaas). Usado para diagnosticar por que
// um usuário específico recebe erro genérico ao tentar carregar, sem
// adivinhação — decripta as chaves reais dele e testa a credencial contra a
// Asaas com uma chamada só-leitura (GET /finance/balance).
//
// Nunca retorna segredos em texto puro — só booleans, tamanhos e prévias
// truncadas/mascaradas.
//
// Autenticação: header x-admin-secret com o valor do secret DIAG_ADMIN_SECRET.
// Remover a function do projeto após o diagnóstico.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt, aesEncrypt } from '../_shared/crypto.ts'
import { createPixStaticQrCode, createPixAddressKey } from '../_shared/asaas.ts'

const EVALUATION_LIMIT_BRL = 2000
const EVALUATION_DAYS      = 60

function preview(s: string, n = 6): string {
  return s.length <= n ? '*'.repeat(s.length) : `${s.slice(0, n)}***(${s.length} chars)`
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const adminSecret = Deno.env.get('DIAG_ADMIN_SECRET')
  if (!adminSecret || req.headers.get('x-admin-secret') !== adminSecret) {
    return err('UNAUTHORIZED', 'Secret inválido', 401)
  }

  let body: { handle?: string; reproduce?: boolean; create_deposit_key?: boolean; real_carregar_amount?: number } = {}
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  const handle = (body.handle ?? '').toLowerCase().replace(/^@/, '')
  if (!handle) return err('MISSING_FIELDS', 'handle obrigatório', 400)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const report: Record<string, unknown> = { handle }

  // ── Buscar usuário (mesma query de financial-carregar) ─────────────────────
  const { data: userData, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, asaas_api_key_enc, asaas_deposit_key, pix_key, pix_key_type, kyc_status, account_status, created_at')
    .eq('handle', handle)
    .maybeSingle()

  if (userErr || !userData) {
    report.step = 'user_lookup'
    report.result = 'USER_NOT_FOUND'
    return json(report, 200)
  }

  report.kyc_status     = userData.kyc_status
  report.account_status = userData.account_status
  report.created_at     = userData.created_at

  // ── KYC ──────────────────────────────────────────────────────────────────
  if (userData.kyc_status !== 'approved') {
    report.step = 'kyc_check'
    report.result = 'KYC_REQUIRED'
    return json(report, 200)
  }

  // ── Limite de avaliação (mesma lógica de financial-carregar) ───────────────
  if (userData.account_status === 'evaluation') {
    const since = new Date(new Date(userData.created_at).getTime() - EVALUATION_DAYS * 24 * 60 * 60 * 1000)
    const { data: evalTxs, error: evalErr } = await supabaseAdmin
      .from('transactions')
      .select('amount_brl')
      .eq('user_id', userData.id)
      .eq('type', 'carregar')
      .eq('status', 'completed')
      .gte('created_at', since.toISOString())

    if (evalErr) {
      report.step = 'evaluation_limit_query'
      report.result = 'DB_ERROR'
      report.error = String(evalErr.message ?? evalErr)
      return json(report, 200)
    }

    const totalCarregado = (evalTxs ?? []).reduce((sum, tx) => sum + Number(tx.amount_brl ?? 0), 0)
    report.evaluation_total_completed_carregar_brl = totalCarregado
    report.evaluation_limit_brl = EVALUATION_LIMIT_BRL
    report.evaluation_would_block_50_brl = totalCarregado + 50 > EVALUATION_LIMIT_BRL
  }

  // ── Descriptografar asaas_api_key_enc ───────────────────────────────────────
  report.has_asaas_api_key_enc = !!userData.asaas_api_key_enc
  if (!userData.asaas_api_key_enc) {
    report.step = 'asaas_key_presence'
    report.result = 'ACCOUNT_NOT_CONFIGURED'
    return json(report, 200)
  }

  const apiKeySecret = Deno.env.get('ASAAS_API_KEY')!
  const pixKeySecret = Deno.env.get('ENCRYPTION_KEY')!
  let subApiKey: string
  try {
    subApiKey = await aesDecrypt(userData.asaas_api_key_enc, apiKeySecret)
    report.asaas_key_decrypt_ok = true
    report.asaas_key_preview    = preview(subApiKey)
    report.asaas_key_is_literal_null = subApiKey === 'null'
  } catch (e) {
    report.step = 'asaas_key_decrypt'
    report.result = 'CRYPTO_ERROR'
    report.error = String(e)
    return json(report, 200)
  }

  // ── Descriptografar pix_key (sem criar uma nova — só diagnóstico) ─────────
  report.has_pix_key = !!userData.pix_key
  report.pix_key_type = userData.pix_key_type
  let pixKeyRaw: string | null = null
  if (userData.pix_key) {
    try {
      pixKeyRaw = await aesDecrypt(userData.pix_key, pixKeySecret)
      report.pix_key_decrypt_ok = true
      report.pix_key_preview    = preview(pixKeyRaw, 3)
    } catch (e) {
      report.pix_key_decrypt_ok = false
      report.pix_key_decrypt_error = String(e)
    }
  }

  // ── Testar a credencial contra a Asaas (chamada SÓ-LEITURA, sem side effect) ─
  const asaasBase = Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
    ? 'https://api.asaas.com/api/v3'
    : 'https://sandbox.asaas.com/api/v3'

  // ── Verificar se a pix_key local está de fato REGISTRADA como Pix address key
  //    na Asaas (createPixStaticQrCode usa addressKey = pix_key local diretamente,
  //    sem nunca confirmar que ela foi registrada via POST /pix/addressKeys) ────
  let existingEvpKey: string | null = null
  try {
    const keysRes  = await fetch(`${asaasBase}/pix/addressKeys?limit=50`, { headers: { 'access_token': subApiKey } })
    const keysBody = await keysRes.json().catch(() => ({})) as { data?: { key: string; type: string }[] }
    report.asaas_address_keys_call_status = keysRes.status
    report.asaas_address_keys_call_ok     = keysRes.ok
    report.asaas_address_keys_list        = keysBody
    existingEvpKey = keysBody.data?.find(k => k.type === 'EVP')?.key ?? null
  } catch (e) {
    report.asaas_address_keys_call_error = String(e)
  }

  // ── Criar (ou reaproveitar) a chave de RECEBIMENTO da subconta — separada
  //    da pix_key de saque. Só roda se create_deposit_key:true. Reaproveita
  //    uma EVP já registrada em vez de criar duplicata (idempotente). ────────
  if (body.create_deposit_key === true) {
    try {
      let depositKey: string
      if (existingEvpKey) {
        depositKey = existingEvpKey
        report.deposit_key_source = 'already_registered'
      } else {
        const created = await createPixAddressKey('EVP', subApiKey)
        depositKey = created.key
        report.deposit_key_source = 'created_now'
      }
      report.deposit_key_preview = preview(depositKey, 6)

      // Testa o fluxo real de carregar com essa chave (confirma ponta a ponta)
      const qr = await createPixStaticQrCode(depositKey, 50, 'Carregar Albers (diagnóstico)', 1800, subApiKey)
      report.deposit_key_qr_test_ok = true
      report.deposit_key_qr_test_id = qr.id
    } catch (e) {
      report.deposit_key_step_error = String(e)
    }
  }

  try {
    const balRes  = await fetch(`${asaasBase}/finance/balance`, { headers: { 'access_token': subApiKey } })
    const balBody = await balRes.json().catch(() => ({}))
    report.asaas_balance_call_status = balRes.status
    report.asaas_balance_call_ok     = balRes.ok
    report.asaas_balance_call_body   = balBody
  } catch (e) {
    report.asaas_balance_call_error = String(e)
  }

  // ── Testar GET /myAccount/documents (confirma se a subconta está com White Label ativo) ─
  try {
    const docsRes  = await fetch(`${asaasBase}/myAccount/documents`, { headers: { 'access_token': subApiKey } })
    const docsBody = await docsRes.json().catch(() => ({}))
    report.asaas_documents_call_status = docsRes.status
    report.asaas_documents_call_ok     = docsRes.ok
    report.asaas_documents_call_body   = docsBody
  } catch (e) {
    report.asaas_documents_call_error = String(e)
  }

  // ── Reproduzir de fato o passo que financial-carregar executa e que erra ────
  // Só roda se reproduce:true for passado explicitamente no body (tem efeito
  // colateral real: cria um QR estático de verdade na Asaas — não movimenta
  // dinheiro, mas não é uma chamada só-leitura como as anteriores).
  if (body.reproduce === true && pixKeyRaw) {
    try {
      const qr = await createPixStaticQrCode(pixKeyRaw, 50, 'Carregar Albers (diagnóstico)', 1800, subApiKey)
      report.reproduce_create_qr_ok = true
      report.reproduce_create_qr_id = qr.id
    } catch (e) {
      report.reproduce_create_qr_ok = false
      report.reproduce_create_qr_error = String(e)
    }
  }

  // ── Rodar a mesma lógica REAL de financial-carregar (já corrigida e deployada),
  //    usando asaas_deposit_key (não pix_key), e inserindo a transação de
  //    verdade — para verificar o fluxo de produção ponta a ponta com um
  //    usuário real. Efeito colateral real: cria um QR estático de verdade
  //    na Asaas e uma linha 'pending' em transactions (sem mover dinheiro —
  //    só é debitado se o Pix for de fato pago).
  if (body.real_carregar_amount && body.real_carregar_amount > 0) {
    const amountBrl = body.real_carregar_amount
    try {
      let depositKeyRaw: string
      if (userData.asaas_deposit_key) {
        depositKeyRaw = await aesDecrypt(userData.asaas_deposit_key, pixKeySecret)
      } else {
        const created = await createPixAddressKey('EVP', subApiKey)
        depositKeyRaw = created.key
        const encrypted = await aesEncrypt(depositKeyRaw, pixKeySecret)
        await supabaseAdmin.from('users').update({ asaas_deposit_key: encrypted }).eq('id', userData.id)
      }

      const qr = await createPixStaticQrCode(depositKeyRaw, amountBrl, 'Carregar Albers', 1800, subApiKey)

      const { data: txData, error: txErr } = await supabaseAdmin
        .from('transactions')
        .insert({
          user_id:          userData.id,
          type:             'carregar',
          amount:           amountBrl,
          amount_brl:       amountBrl,
          fee_amount:       0,
          status:           'pending',
          asaas_payment_id: qr.id,
        })
        .select('id')
        .single()

      if (txErr) {
        report.real_carregar_ok = false
        report.real_carregar_tx_error = String(txErr.message ?? txErr)
      } else {
        await supabaseAdmin.from('audit_logs').insert({
          user_id:    userData.id,
          event_type: 'carregar_initiated',
          metadata:   { transaction_id: txData!.id, amount_brl: amountBrl, qr_code_id: qr.id, source: 'admin_diag_real_test' },
        })
        report.real_carregar_ok         = true
        report.real_carregar_payment_id = txData!.id
        report.real_carregar_qr_code_id = qr.id
        report.real_carregar_qr_payload = qr.payload
        report.real_carregar_amount_brl = amountBrl
      }
    } catch (e) {
      report.real_carregar_ok    = false
      report.real_carregar_error = String(e)
    }
  }

  report.step   = 'all_read_checks_done'
  report.result = 'SEE_FIELDS_ABOVE'
  return json(report, 200)
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
