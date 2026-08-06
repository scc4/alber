// Spec: /specs/06_modules/perfil.md — Conta e Privacidade > Excluir minha conta
// Soft delete: a linha em users é preservada (obrigação de retenção de dados
// financeiros) e anonimizada; nenhuma tabela financeira/social é apagada.
//
// POST /conta-excluir { action: 'status' }
//   Só exige JWT — retorna se a conta pode ser excluída agora (saldo, splits,
//   lounges) para a tela mostrar o bloqueio ANTES do usuário passar por
//   PIN + pergunta de segurança + SMS à toa.
//
// POST /conta-excluir { action: 'confirm', pin_hash, security_answer_hash, sms_code }
//   Efetiva a exclusão. Revalida as mesmas precondições no servidor (nunca
//   confia só na checagem que o client já fez antes).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt, bcryptVerify, verifyPinWithPairs, tryParsePairsPayload } from '../_shared/crypto.ts'
import { getSubcontaBalance } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

interface ConfirmBody {
  action:                'confirm'
  pin_hash:               string
  security_answer_hash:   string
  sms_code:               string
}
interface StatusBody {
  action: 'status'
}

type Body = StatusBody | ConfirmBody | { action?: string }

interface EligibilityBlocks {
  positive_balance:            boolean
  owns_active_split:            boolean
  owns_active_lounge:           boolean
  active_split_participation:   boolean
}

async function checkEligibility(
  supabaseAdmin: SupabaseClient,
  userId: string,
  asaasApiKeyEnc: string | null,
): Promise<{ blocks: EligibilityBlocks; balanceBrl: number; eligible: boolean }> {
  let balanceBrl = 0
  if (asaasApiKeyEnc) {
    try {
      const subApiKey = await aesDecrypt(asaasApiKeyEnc, Deno.env.get('ASAAS_API_KEY')!)
      balanceBrl = await getSubcontaBalance(subApiKey)
    } catch (e) {
      console.error('[conta-excluir] balance check failed:', e)
      // Não decidimos "elegível" às cegas se não deu pra checar o saldo —
      // trata como saldo positivo (bloqueia) para o lado seguro.
      balanceBrl = 1
    }
  }

  const { data: activeSplitsOwned } = await supabaseAdmin
    .from('splits').select('id')
    .eq('owner_id', userId).eq('status', 'open').limit(1) as { data: { id: string }[] | null }
  const { data: activeLoungesOwned } = await supabaseAdmin
    .from('spaces').select('id')
    .eq('owner_id', userId).eq('status', 'active').limit(1) as { data: { id: string }[] | null }
  const { data: blockedParticipations } = await supabaseAdmin
    .from('split_participants').select('split_id')
    .eq('user_id', userId).gt('blocked_amount', 0) as { data: { split_id: string }[] | null }

  // Dos splits onde o usuário tem saldo bloqueado, checa se algum ainda está aberto
  // (query separada em vez de join embutido — segue o padrão simples já usado no resto do app)
  let hasActiveParticipation = false
  const splitIds = (blockedParticipations ?? []).map(p => p.split_id)
  if (splitIds.length > 0) {
    const { data: openBlockedSplits } = await supabaseAdmin
      .from('splits').select('id')
      .in('id', splitIds).eq('status', 'open').limit(1) as { data: { id: string }[] | null }
    hasActiveParticipation = (openBlockedSplits?.length ?? 0) > 0
  }

  const blocks: EligibilityBlocks = {
    positive_balance:            balanceBrl > 0,
    owns_active_split:            (activeSplitsOwned?.length ?? 0) > 0,
    owns_active_lounge:           (activeLoungesOwned?.length ?? 0) > 0,
    active_split_participation:   hasActiveParticipation,
  }

  const eligible = !Object.values(blocks).some(Boolean)
  return { blocks, balanceBrl, eligible }
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: Body
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, auth_id, asaas_api_key_enc, deleted_at')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  if (user.deleted_at) return err('ALREADY_DELETED', 'Conta já excluída', 409)

  // ── action: status — só elegibilidade, sem PIN/segurança ────────────────────

  if (body.action === 'status') {
    const { blocks, balanceBrl, eligible } = await checkEligibility(supabaseAdmin, user.id, user.asaas_api_key_enc)
    return json({ eligible, balance_brl: balanceBrl, blocks })
  }

  if (body.action !== 'confirm') return err('INVALID_ACTION', 'action deve ser "status" ou "confirm"', 400)

  const { pin_hash, security_answer_hash, sms_code } = body as ConfirmBody
  if (!pin_hash)             return err('MISSING_FIELDS', 'pin_hash é obrigatório', 400)
  if (!security_answer_hash) return err('MISSING_FIELDS', 'security_answer_hash é obrigatório', 400)
  if (!sms_code)             return err('MISSING_FIELDS', 'sms_code é obrigatório', 400)

  // ── Revalidar elegibilidade no servidor (nunca confiar só no client) ────────

  const { eligible, blocks } = await checkEligibility(supabaseAdmin, user.id, user.asaas_api_key_enc)
  if (!eligible) return err('NOT_ELIGIBLE', 'Existem pendências que impedem a exclusão da conta', 422, { blocks })

  // ── Verificar PIN ────────────────────────────────────────────────────────────

  const { data: authMeta } = await supabaseAdmin.auth.admin.getUserById(user.auth_id)
  const pinBcrypt: string | undefined = authMeta?.user?.app_metadata?.pin_bcrypt
  const pinSha256: string | undefined = authMeta?.user?.app_metadata?.pin_sha256

  if (!pinBcrypt) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)

  let pinOk = false
  const pairs = tryParsePairsPayload(pin_hash)
  if (pairs) {
    if (!pinSha256) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
    const result = await verifyPinWithPairs(pinSha256, pairs)
    pinOk = result.ok
  } else {
    pinOk = pinSha256 ? pin_hash === pinSha256 : await bcryptVerify(pin_hash, pinBcrypt)
  }

  if (!pinOk) {
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: user.id, event_type: 'account_delete_pin_failed', metadata: {},
      })
    } catch { /* não-crítico */ }
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
  }

  // ── Verificar pergunta de segurança ──────────────────────────────────────────

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('answer_hash')
    .eq('user_id', user.id)

  if (!questions || questions.length === 0) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)

  let securityOk = false
  for (const q of questions) {
    if (await bcryptVerify(security_answer_hash, q.answer_hash)) { securityOk = true; break }
  }
  if (!securityOk) {
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: user.id, event_type: 'account_delete_security_failed', metadata: {},
      })
    } catch { /* não-crítico */ }
    return err('WRONG_SECURITY_ANSWER', 'Resposta de segurança incorreta', 401)
  }

  // ── Verificar SMS code ────────────────────────────────────────────────────

  const now = new Date().toISOString()
  const { data: smsRow } = await supabaseAdmin
    .from('sms_codes')
    .select('id, code, expires_at, used_at')
    .eq('user_id', user.id)
    .eq('purpose', 'account_delete')
    .is('used_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!smsRow) return err('SMS_EXPIRED', 'Código SMS expirado ou inválido. Solicite um novo.', 401)
  if (smsRow.code !== sms_code.trim()) return err('SMS_INVALID', 'Código SMS incorreto', 401)

  await supabaseAdmin.from('sms_codes').update({ used_at: now }).eq('id', smsRow.id)

  // ── Efetivar soft delete ─────────────────────────────────────────────────────
  // name/handle/email sobrescritos com placeholder único (handle/email têm
  // UNIQUE NOT NULL) — cobre de uma vez toda leitura ao vivo por terceiros
  // (busca, extrato, lounge, split) sem precisar alterar cada Edge Function.
  // cpf (já é hash) e dados financeiros (transactions, splits, etc.) NÃO são
  // tocados — retidos por obrigação legal.

  const shortId = user.id.slice(0, 8)
  const { error: updateErr } = await supabaseAdmin
    .from('users')
    .update({
      name:       'Usuário removido',
      handle:     `removido-${shortId}`,
      email:      `deleted-${user.id}@alber.invalid`,
      deleted_at: now,
    })
    .eq('id', user.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'conta-excluir', updateErr, { user_id: user.id })
    return err('DB_ERROR', 'Erro ao excluir conta', 500)
  }

  // ── Derrubar todas as sessões ─────────────────────────────────────────────
  // signOut espera um JWT válido (não um user id) — usa o próprio token da
  // requisição atual. Com scope 'global', revoga em todos os devices.

  try {
    const currentJwt = authHeader.replace(/^Bearer\s+/i, '')
    await supabaseAdmin.auth.admin.signOut(currentJwt, 'global')
  } catch (e) {
    console.warn('[conta-excluir] signOut error (não crítico):', e)
  }

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    user.id,
      event_type: 'account_deleted',
      metadata:   { blocks },
    })
  } catch { /* não-crítico */ }

  return json({ success: true })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
