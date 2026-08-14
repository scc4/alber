// Spec: /specs/03_backend.md §4.3 (balance não listado mas inferido de §5.3)
// Spec: /specs/04_api_asaas.md §4.8
// Cálculo: available = saldo Asaas (BRL ≡ Albers 1:1, spec §5)
//          blocked   = Σ split_participants.blocked_amount WHERE status='accepted'
//          total     = available + blocked

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt } from '../_shared/crypto.ts'
import { getSubcontaBalance } from '../_shared/asaas.ts'
import { resolveWalletContext } from '../_shared/company-permissions.ts'

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'GET') return err('METHOD_NOT_ALLOWED', 'Use GET', 405)

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

  // ── Buscar dados do usuário (admin para campos cifrados) ──────────────────────

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: userData, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, asaas_api_key_enc, account_status, kyc_status, created_at')
    .eq('auth_id', user.id)
    .maybeSingle()

  if (userErr || !userData) {
    return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  }

  // ── Resolver carteira: pessoal ou empresa (?company_id=) ──────────────────────

  const companyId = new URL(req.url).searchParams.get('company_id')

  const resolution = await resolveWalletContext(supabaseAdmin, userData.id, companyId, 'ver_saldo', userData)
  if (!resolution.ok) return err(resolution.code, resolution.message, resolution.status)
  const wallet = resolution.wallet

  // ── Saldo disponível via Asaas (spec 04_api §4.8) ────────────────────────────

  let asaasBalance = 0
  let asaasError   = false
  let subApiKey:  string | null = null

  if (wallet.asaasApiKeyEnc) {
    try {
      const encSecret = Deno.env.get('ASAAS_API_KEY')!
      subApiKey       = await aesDecrypt(wallet.asaasApiKeyEnc, encSecret)
      asaasBalance    = await getSubcontaBalance(subApiKey)
    } catch (e) {
      console.error('Asaas balance fetch failed:', e)
      asaasError = true
      // Continua com saldo 0 — erro não-bloqueante para leitura
    }
  }

  // ── Polling de KYC: sincroniza status Asaas → banco se ainda 'pending' ───────
  // Complementa o webhook — garante que aprovações não percam notificação.

  let kycStatus = wallet.kycStatus

  if (kycStatus === 'pending' && subApiKey) {
    try {
      const asaasBase = Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
        ? 'https://api.asaas.com/api/v3'
        : 'https://sandbox.asaas.com/api/v3'
      const statusRes = await fetch(`${asaasBase}/myAccount/status`, {
        headers: { 'access_token': subApiKey },
      })
      if (statusRes.ok) {
        const statusData = await statusRes.json() as { general?: string }
        console.log('[financial-balance] Asaas account status:', statusData.general)
        if (statusData.general === 'APPROVED') {
          const { error: updateErr } = await supabaseAdmin
            .from(wallet.ownerType === 'company' ? 'companies' : 'users')
            .update({ kyc_status: 'approved' })
            .eq('id', wallet.companyId ?? userData.id)
          if (updateErr) {
            console.error('[financial-balance] kyc_status update failed:', updateErr)
          } else {
            kycStatus = 'approved'
            console.log('[financial-balance] kyc_status atualizado para approved via polling')
          }
        }
      } else {
        console.warn('[financial-balance] GET /myAccount/status status:', statusRes.status)
      }
    } catch (e) {
      console.warn('[financial-balance] Asaas status check failed (não-crítico):', e)
    }
  }

  // ── Saldo bloqueado em splits (spec 03_backend §5.3) ─────────────────────────
  // blocked = Σ blocked_amount WHERE user_id = ? AND status = 'accepted'
  // Splits são só pessoais nesta fase — carteira de empresa não participa.

  let blocked = 0

  if (wallet.ownerType === 'personal') {
    const { data: participations, error: splitErr } = await supabaseAdmin
      .from('split_participants')
      .select('blocked_amount')
      .eq('user_id', userData.id)
      .eq('status', 'accepted')

    if (splitErr) {
      console.error('Split participants query failed:', splitErr)
    }

    blocked = (participations ?? []).reduce(
      (sum, p) => sum + Number(p.blocked_amount ?? 0),
      0,
    )
  }

  const available = Math.max(0, asaasBalance)
  const total     = available + blocked

  return json({
    available,
    blocked,
    total,
    currency:       'ALB',
    stale:          asaasError,
    kyc_status:     kycStatus,
    account_status: wallet.accountStatus,
  })
})
