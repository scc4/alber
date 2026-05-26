// Spec: /specs/03_backend.md §4.3 (balance não listado mas inferido de §5.3)
// Spec: /specs/04_api_asaas.md §4.8
// Cálculo: available = saldo Asaas (BRL ≡ Albers 1:1, spec §5)
//          blocked   = Σ split_participants.blocked_amount WHERE status='accepted'
//          total     = available + blocked

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../../_shared/cors.ts'
import { aesDecrypt } from '../../_shared/crypto.ts'
import { getSubcontaBalance } from '../../_shared/asaas.ts'

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
    .select('id, asaas_api_key_enc, account_status, kyc_status')
    .eq('auth_id', user.id)
    .maybeSingle()

  if (userErr || !userData) {
    return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  }

  // ── Saldo disponível via Asaas (spec 04_api §4.8) ────────────────────────────

  let asaasBalance = 0
  let asaasError   = false

  if (userData.asaas_api_key_enc) {
    try {
      const encSecret  = Deno.env.get('ASAAS_API_KEY')!
      const subApiKey  = await aesDecrypt(userData.asaas_api_key_enc, encSecret)
      asaasBalance     = await getSubcontaBalance(subApiKey)
    } catch (e) {
      console.error('Asaas balance fetch failed:', e)
      asaasError = true
      // Continua com saldo 0 — erro não-bloqueante para leitura
    }
  }

  // ── Saldo bloqueado em splits (spec 03_backend §5.3) ─────────────────────────
  // blocked = Σ blocked_amount WHERE user_id = ? AND status = 'accepted'

  const { data: participations, error: splitErr } = await supabaseAdmin
    .from('split_participants')
    .select('blocked_amount')
    .eq('user_id', userData.id)
    .eq('status', 'accepted')

  if (splitErr) {
    console.error('Split participants query failed:', splitErr)
  }

  const blocked = (participations ?? []).reduce(
    (sum, p) => sum + Number(p.blocked_amount ?? 0),
    0,
  )

  const available = Math.max(0, asaasBalance)
  const total     = available + blocked

  return json({
    available,
    blocked,
    total,
    currency:    'ALB',
    // Indica ao app que o saldo pode estar desatualizado
    stale:       asaasError,
    kyc_status:  userData.kyc_status,
    account_status: userData.account_status,
  })
})
