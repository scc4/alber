// Spec: /specs/03_backend.md §6 (webhook HMAC validation)
// Spec: /specs/04_api_asaas.md §4.7 (KYC documents)
// Evento esperado: ACCOUNT_STATUS_CHANGED
// Payload Asaas: { event, account: { id, status } }
// Status Asaas → kyc_status interno:
//   APPROVED   → 'approved'
//   REJECTED   → 'rejected'
//   RESTRICTED → 'rejected'   (funcionalidade limitada = tratado como reprovado)
//   outros     → sem alteração (200 imediato)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── Mapeamento status Asaas → kyc_status interno ─────────────────────────────

function mapKycStatus(asaasStatus: string): 'approved' | 'rejected' | null {
  const s = asaasStatus.toUpperCase()
  if (s === 'APPROVED') return 'approved'
  if (s === 'REJECTED' || s === 'RESTRICTED') return 'rejected'
  return null   // PENDING ou outros — sem alteração
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

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
    .select('id, name, kyc_status, asaas_api_key_enc, pix_key')
    .eq('asaas_account_id', asaasAccountId)
    .maybeSingle()

  if (userErr || !userData) {
    // Pode ser subconta de Space ou conta não encontrada — não é erro crítico
    console.warn('[kyc-webhook] usuário não encontrado para asaas_account_id:', asaasAccountId)
    return new Response('OK', { status: 200 })
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

  // ── Criar chave Pix EVP se ainda não tiver ───────────────────────────────────

  if (newKycStatus === 'approved' && !userData.pix_key && userData.asaas_api_key_enc) {
    try {
      const subApiKey    = await aesDecrypt(userData.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
      const { key }      = await createPixAddressKey('EVP', subApiKey)
      const encryptedKey = await aesEncrypt(key, Deno.env.get('ENCRYPTION_KEY')!)
      await supabaseAdmin
        .from('users')
        .update({ pix_key: encryptedKey, pix_key_type: 'random' })
        .eq('id', userData.id)
      console.log(`[kyc-webhook] chave Pix EVP criada para usuário ${userData.id}`)
    } catch (pixErr) {
      console.error('[kyc-webhook] falha ao criar chave Pix EVP (não bloqueante):', pixErr)
      await logError(supabaseAdmin, 'webhooks-asaas-kyc', pixErr, {
        context: 'create_pix_key',
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
})
