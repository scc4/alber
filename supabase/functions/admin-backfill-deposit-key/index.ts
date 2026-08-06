// Migração de dados — ÚNICA EXECUÇÃO (one-off)
// POST /admin-backfill-deposit-key { dry_run?: boolean }
//
// Backfill do bug reportado pelo usuário "daniel": contas cadastradas antes da
// correção do auth-register/financial-carregar/webhooks-asaas-kyc não têm
// asaas_deposit_key (chave Pix EVP de recebimento, própria da subconta,
// separada da pix_key de saque escolhida pelo usuário). Sem essa chave, gerar
// QR code de carregamento falha na Asaas com "Chave Pix não encontrada".
//
// Para cada usuário com KYC aprovado, subconta configurada e sem
// asaas_deposit_key:
//   1. Consulta GET /pix/addressKeys na Asaas — se já existir uma chave EVP
//      registrada (ex.: criada manualmente durante diagnóstico), reaproveita
//      em vez de criar uma nova.
//   2. Senão, registra uma nova via POST /pix/addressKeys (EVP).
//   3. Criptografa com ENCRYPTION_KEY e grava em asaas_deposit_key.
//
// Idempotente: rodar mais de uma vez é seguro (quem já tem asaas_deposit_key
// é ignorado). dry_run (default true): só simula e retorna contagens.
//
// Autenticação: header x-admin-secret com o valor do secret BACKFILL_ADMIN_SECRET
// (dedicado a esta function one-off).
//
// Deploy:   supabase functions deploy admin-backfill-deposit-key
// Chamada:  curl -X POST '<SUPABASE_URL>/functions/v1/admin-backfill-deposit-key' \
//             -H 'x-admin-secret: <BACKFILL_ADMIN_SECRET>' -H 'Content-Type: application/json' \
//             -d '{"dry_run": false}'
// Remover a function do projeto após confirmado que rodou com sucesso.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt, aesEncrypt } from '../_shared/crypto.ts'
import { createPixAddressKey } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

const PAGE_SIZE = 500

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const adminSecret = Deno.env.get('BACKFILL_ADMIN_SECRET')
  if (!adminSecret || req.headers.get('x-admin-secret') !== adminSecret) {
    return err('UNAUTHORIZED', 'Secret inválido', 401)
  }

  let body: { dry_run?: boolean } = {}
  try {
    if (req.headers.get('content-length') !== '0') body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }
  const dryRun = body.dry_run !== false // default: true

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const apiKeySecret = Deno.env.get('ASAAS_API_KEY')!
  const depositSecret = Deno.env.get('ENCRYPTION_KEY')!
  const asaasBase = Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
    ? 'https://api.asaas.com/api/v3'
    : 'https://sandbox.asaas.com/api/v3'

  let alreadyHad     = 0
  let adoptedExisting = 0
  let createdNew      = 0
  let failed          = 0
  const failedSamples: { user_id: string; error: string }[] = []

  let offset = 0
  for (;;) {
    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('id, asaas_api_key_enc, asaas_deposit_key')
      .eq('kyc_status', 'approved')
      .not('asaas_api_key_enc', 'is', null)
      .is('asaas_deposit_key', null)
      .range(offset, offset + PAGE_SIZE - 1)

    if (fetchErr) {
      await logError(supabaseAdmin, 'admin-backfill-deposit-key', fetchErr, {})
      return err('DB_ERROR', 'Erro ao buscar usuários', 500)
    }
    if (!rows || rows.length === 0) break

    for (const u of rows as { id: string; asaas_api_key_enc: string; asaas_deposit_key: string | null }[]) {
      try {
        const subApiKey = await aesDecrypt(u.asaas_api_key_enc, apiKeySecret)

        // Passo 1 — já existe uma EVP registrada na Asaas (ex.: criada manualmente)?
        let depositKey: string | null = null
        let source: 'adopted_existing' | 'created_new' = 'created_new'
        try {
          const keysRes  = await fetch(`${asaasBase}/pix/addressKeys?limit=50`, { headers: { 'access_token': subApiKey } })
          const keysBody = await keysRes.json().catch(() => ({})) as { data?: { key: string; type: string }[] }
          const existing = keysBody.data?.find(k => k.type === 'EVP')
          if (existing) {
            depositKey = existing.key
            source = 'adopted_existing'
          }
        } catch { /* segue para criar uma nova */ }

        // Passo 2 — senão, cria
        if (!depositKey) {
          const created = await createPixAddressKey('EVP', subApiKey)
          depositKey = created.key
        }

        if (!dryRun) {
          const encrypted = await aesEncrypt(depositKey, depositSecret)
          const { error: updateErr } = await supabaseAdmin
            .from('users')
            .update({ asaas_deposit_key: encrypted })
            .eq('id', u.id)
          if (updateErr) {
            await logError(supabaseAdmin, 'admin-backfill-deposit-key', updateErr, { user_id: u.id })
            failed++
            failedSamples.push({ user_id: u.id, error: String(updateErr.message ?? updateErr) })
            continue
          }
        }

        if (source === 'adopted_existing') adoptedExisting++
        else createdNew++
      } catch (e) {
        await logError(supabaseAdmin, 'admin-backfill-deposit-key', e, { user_id: u.id })
        failed++
        failedSamples.push({ user_id: u.id, error: String(e) })
      }
    }

    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  // Contagem informativa de quantos já tinham (fora do range buscado acima)
  const { count: alreadyHadCount } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('kyc_status', 'approved')
    .not('asaas_deposit_key', 'is', null)
  alreadyHad = alreadyHadCount ?? 0

  return json({
    dry_run: dryRun,
    already_had: alreadyHad,
    adopted_existing: adoptedExisting,
    created_new: createdNew,
    failed,
    failed_samples: failedSamples,
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
