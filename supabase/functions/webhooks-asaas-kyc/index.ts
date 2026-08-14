// Spec: /specs/03_backend.md §6 (webhook HMAC validation)
// Spec: /specs/04_api_asaas.md §4.7 (KYC documents)
// Evento esperado: ACCOUNT_STATUS_CHANGED
// Payload Asaas: { event, account: { id, status } }
// Status Asaas → kyc_status interno:
//   APPROVED   → 'approved'
//   REJECTED   → 'rejected'
//   RESTRICTED → 'rejected'   (funcionalidade limitada = tratado como reprovado)
//   outros     → sem alteração (200 imediato)
//
// Plano velvet-puzzling-sedgewick (ciclo de vida do KYC de empresa): a
// subconta pode ser de uma `users` (pessoa física) OU de uma `companies`
// (empresa) — tenta users primeiro (comportamento de sempre) e cai para
// companies quando não encontra. Rejeição de empresa também marca
// deleted_at, liberando o CNPJ/handle automaticamente (migration 044).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'
import { aesDecrypt, aesEncrypt } from '../_shared/crypto.ts'
import { createPixAddressKey } from '../_shared/asaas.ts'

// Asaas envia o authToken configurado no header 'asaas-access-token' (mesmo padrão do pix webhook)
const HANDLED_EVENTS = new Set([
  'ACCOUNT_STATUS_CHANGED',
  'ACCOUNT_APPROVED',    // nomes alternativos — confirmar com Asaas (spec §9)
  'ACCOUNT_REJECTED',
])

// ── Mapeamento status Asaas → kyc_status interno ─────────────────────────────

function mapKycStatus(asaasStatus: string): 'approved' | 'rejected' | null {
  const s = asaasStatus.toUpperCase()
  if (s === 'APPROVED') return 'approved'
  if (s === 'REJECTED' || s === 'RESTRICTED') return 'rejected'
  return null   // PENDING ou outros — sem alteração
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Validar token do webhook (spec §6) ───────────────────────────────────────
  // Asaas envia o authToken configurado no header 'asaas-access-token'.
  // Comparação direta (token longo + canal TLS — mesmo padrão de webhooks-asaas-pix).

  const receivedToken = req.headers.get('asaas-access-token')
  const expectedToken = Deno.env.get('ASAAS_WEBHOOK_SECRET')!

  if (!receivedToken || receivedToken !== expectedToken) {
    console.warn('[kyc-webhook] Token inválido')
    return new Response('Unauthorized', { status: 401 })
  }

  // ── Parse do payload ─────────────────────────────────────────────────────────

  let payload: {
    event:   string
    account?: {
      id:     string    // asaas_account_id da subconta
      status: string    // APPROVED | REJECTED | RESTRICTED | PENDING
    }
    // Alguns eventos podem usar campos alternativos — tratados abaixo
    id?:     string
    status?: string
  }

  try {
    payload = await req.json()
  } catch (e) {
    console.error('[kyc-webhook] JSON inválido')
    await logError(supabaseAdmin, 'webhooks-asaas-kyc', e, {})
    return new Response('Bad Request', { status: 400 })
  }

  const { event } = payload
  console.log(`[kyc-webhook] event=${event}`)

  // ── Ignorar eventos não relacionados a KYC ────────────────────────────────────

  if (!HANDLED_EVENTS.has(event)) {
    return new Response('OK', { status: 200 })
  }

  // ── Extrair account ID e status (normalizar variações de payload) ─────────────

  const asaasAccountId = payload.account?.id ?? payload.id
  const rawStatus      = payload.account?.status ?? payload.status ?? ''

  if (!asaasAccountId) {
    console.warn('[kyc-webhook] account.id ausente no payload')
    return new Response('OK', { status: 200 })
  }

  const newKycStatus = mapKycStatus(rawStatus)

  if (!newKycStatus) {
    // Status intermediário (PENDING etc.) — sem ação no banco
    console.log(`[kyc-webhook] status "${rawStatus}" sem ação — ignorando`)
    return new Response('OK', { status: 200 })
  }

  // ── Localizar usuário pelo asaas_account_id ───────────────────────────────────

  const { data: userData, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, name, kyc_status, asaas_api_key_enc, asaas_deposit_key')
    .eq('asaas_account_id', asaasAccountId)
    .maybeSingle()

  if (userErr || !userData) {
    // Não é uma subconta pessoal — tenta como subconta de empresa antes de desistir.
    return await handleCompanyKyc(supabaseAdmin, asaasAccountId, newKycStatus, event, rawStatus)
  }

  // ── Idempotência — já no status final ────────────────────────────────────────

  if (userData.kyc_status === newKycStatus) {
    console.log(`[kyc-webhook] kyc_status já é "${newKycStatus}" — ignorando`)
    return new Response('OK', { status: 200 })
  }

  // ── Atualizar kyc_status ──────────────────────────────────────────────────────

  const now = new Date().toISOString()
  const updatePayload: Record<string, unknown> = { kyc_status: newKycStatus, updated_at: now }
  if (newKycStatus === 'approved') {
    updatePayload.onboarding_completed_at = now
  }

  const { error: updateErr } = await supabaseAdmin
    .from('users')
    .update(updatePayload)
    .eq('id', userData.id)

  if (updateErr) {
    console.error('[kyc-webhook] falha ao atualizar kyc_status:', updateErr)
    await logError(supabaseAdmin, 'webhooks-asaas-kyc', updateErr, { event, asaas_account_id: asaasAccountId, new_kyc_status: newKycStatus })
    return new Response('Internal Server Error', { status: 500 })
  }

  console.log(`[kyc-webhook] usuário ${userData.id} → kyc_status="${newKycStatus}"`)

  // ── Criar chave Pix de RECEBIMENTO (EVP) se ainda não tiver ──────────────────
  // Distinta de pix_key (chave de saque escolhida pelo usuário) — asaas_deposit_key
  // é sempre EVP, própria da subconta, usada em financial-carregar.

  if (newKycStatus === 'approved' && !userData.asaas_deposit_key && userData.asaas_api_key_enc) {
    try {
      const subApiKey    = await aesDecrypt(userData.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
      const { key }      = await createPixAddressKey('EVP', subApiKey)
      const encryptedKey = await aesEncrypt(key, Deno.env.get('ENCRYPTION_KEY')!)
      await supabaseAdmin
        .from('users')
        .update({ asaas_deposit_key: encryptedKey })
        .eq('id', userData.id)
      console.log(`[kyc-webhook] chave Pix de recebimento (EVP) criada para usuário ${userData.id}`)
    } catch (pixErr) {
      console.error('[kyc-webhook] falha ao criar chave Pix de recebimento (não bloqueante):', pixErr)
      await logError(supabaseAdmin, 'webhooks-asaas-kyc', pixErr, {
        context: 'create_deposit_key',
        user_id: userData.id,
        asaas_account_id: asaasAccountId,
      })
    }
  }

  // ── Push notification ao usuário ─────────────────────────────────────────────

  if (newKycStatus === 'approved') {
    await sendPush(
      userData.id,
      'Conta verificada!',
      'Sua conta foi verificada! Já pode usar o Alber.',
      { route: '/(app)/perfil/kyc' },
    )
  } else {
    await sendPush(
      userData.id,
      'Verificação não aprovada',
      'Sua verificação de identidade não foi concluída. Acesse o app para mais informações.',
      { route: '/(app)/perfil/kyc' },
    )
  }

  // ── Audit log ────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    userData.id,
    event_type: `kyc_status_${newKycStatus}`,
    metadata: {
      asaas_account_id: asaasAccountId,
      asaas_event:      event,
      asaas_status:     rawStatus,
      previous_status:  userData.kyc_status,
    },
  })

  return new Response('OK', { status: 200 })
}

// ── Ramo empresa (companies) ──────────────────────────────────────────────────
// Espelha a lógica acima, com uma diferença: rejeição também marca deleted_at,
// liberando o CNPJ/handle da empresa (índices parciais da migration 044) para
// que outra pessoa possa cadastrar o mesmo CNPJ — nunca mexe na subconta Asaas
// em si, que fica órfã (trade-off aceito, documentado no plano).
async function handleCompanyKyc(
  supabaseAdmin: SupabaseClient,
  asaasAccountId: string,
  newKycStatus: 'approved' | 'rejected',
  event: string,
  rawStatus: string,
): Promise<Response> {
  const { data: companyData, error: companyErr } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, kyc_status, asaas_api_key_enc, asaas_deposit_key')
    .eq('asaas_account_id', asaasAccountId)
    .is('deleted_at', null)
    .maybeSingle()

  if (companyErr || !companyData) {
    console.warn('[kyc-webhook] nem usuário nem empresa encontrados para asaas_account_id:', asaasAccountId)
    return new Response('OK', { status: 200 })
  }

  if (companyData.kyc_status === newKycStatus) {
    console.log(`[kyc-webhook] empresa ${companyData.id} já está em kyc_status="${newKycStatus}" — ignorando`)
    return new Response('OK', { status: 200 })
  }

  const now = new Date().toISOString()
  const updatePayload: Record<string, unknown> = { kyc_status: newKycStatus, updated_at: now }
  if (newKycStatus === 'approved') {
    updatePayload.onboarding_completed_at = now
  } else {
    // Libera CNPJ/handle na hora — decisão de produto: nenhuma revisão manual
    // intermediária, o Asaas já fez a checagem real de documentos.
    updatePayload.deleted_at = now
  }

  const { error: updateErr } = await supabaseAdmin
    .from('companies')
    .update(updatePayload)
    .eq('id', companyData.id)

  if (updateErr) {
    console.error('[kyc-webhook] falha ao atualizar kyc_status da empresa:', updateErr)
    await logError(supabaseAdmin, 'webhooks-asaas-kyc', updateErr, {
      event, asaas_account_id: asaasAccountId, new_kyc_status: newKycStatus, company_id: companyData.id,
    })
    return new Response('Internal Server Error', { status: 500 })
  }

  console.log(`[kyc-webhook] empresa ${companyData.id} → kyc_status="${newKycStatus}"`)

  // ── Criar chave Pix de RECEBIMENTO (EVP) se ainda não tiver ──────────────────

  if (newKycStatus === 'approved' && !companyData.asaas_deposit_key && companyData.asaas_api_key_enc) {
    try {
      const subApiKey    = await aesDecrypt(companyData.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
      const { key }      = await createPixAddressKey('EVP', subApiKey)
      const encryptedKey = await aesEncrypt(key, Deno.env.get('ENCRYPTION_KEY')!)
      await supabaseAdmin
        .from('companies')
        .update({ asaas_deposit_key: encryptedKey })
        .eq('id', companyData.id)
      console.log(`[kyc-webhook] chave Pix de recebimento (EVP) criada para empresa ${companyData.id}`)
    } catch (pixErr) {
      console.error('[kyc-webhook] falha ao criar chave Pix de recebimento da empresa (não bloqueante):', pixErr)
      await logError(supabaseAdmin, 'webhooks-asaas-kyc', pixErr, {
        context: 'create_deposit_key', company_id: companyData.id, asaas_account_id: asaasAccountId,
      })
    }
  }

  // ── Push notification ao master ──────────────────────────────────────────────

  if (newKycStatus === 'approved') {
    await sendPush(
      companyData.owner_id,
      'Empresa verificada!',
      'A verificação da sua empresa foi concluída. Já pode usar o Alber.',
      { route: `/(app)/empresas/${companyData.id}` },
    )
  } else {
    await sendPush(
      companyData.owner_id,
      'Verificação da empresa não aprovada',
      'A verificação de identidade da empresa não foi concluída. Acesse o app para mais informações.',
      { route: `/(app)/empresas/${companyData.id}` },
    )
  }

  // ── Audit log ────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    companyData.owner_id,
    event_type: `company_kyc_status_${newKycStatus}`,
    metadata: {
      company_id:       companyData.id,
      asaas_account_id: asaasAccountId,
      asaas_event:      event,
      asaas_status:     rawStatus,
      previous_status:  companyData.kyc_status,
    },
  })

  return new Response('OK', { status: 200 })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
