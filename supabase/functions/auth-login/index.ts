// Spec: /specs/03_backend.md §4.2
// Spec: /specs/05_security.md §2, §3, §4, §6

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../_shared/cpf.ts'
import { verifyPinWithPairs, tryParsePairsPayload, loadPinCreds, pinMatches, verifyAnswerHash, sessionPassword, cpfHash } from '../_shared/crypto.ts'
import {
  isCurrentlyBlocked, recordFailureAndMaybeBlock,
  PIN_FAILURE_THRESHOLD, SECURITY_FAILURE_THRESHOLD, LOGIN_BLOCK_MINUTES,
} from '../_shared/login-lockout.ts'
import { isCompanyMember } from '../_shared/operator-login.ts'

interface LoginRequest {
  cpf?: string
  pin_hash: string
  security_answer_hash: string
  security_answer_hash_legacy?: string   // dev-fallback hash — migração de contas antigas
  // Login "como empresa" — a pessoa já escolheu qual operador ela é na tela
  // de seleção (ver auth-company-lookup), em vez de digitar cpf/@handle.
  company_id?:   string
  operator_ref?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logAudit(
  supabaseAdmin: SupabaseClient,
  userId: string | null,
  eventType: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    userId,
    event_type: eventType,
    metadata:   meta,
  })
}

function blockedResponse(blockedUntil: string) {
  return err(
    'ACCOUNT_BLOCKED',
    `Login bloqueado por ${LOGIN_BLOCK_MINUTES} minutos após tentativas excessivas`,
    403,
    { blocked_until: blockedUntil },
  )
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: LoginRequest
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { cpf, pin_hash, security_answer_hash, security_answer_hash_legacy, company_id, operator_ref } = body

  if (!pin_hash || !security_answer_hash) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }
  if (!cpf && !(company_id && operator_ref)) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }

  // ── Localizar usuário ────────────────────────────────────────────────────────
  // Dois caminhos: cpf (cpf/@handle pessoal, fluxo de sempre) ou
  // company_id + operator_ref (login "como empresa" — a pessoa já escolheu
  // qual operador ela é na tela de seleção, ver auth-company-lookup).

  const USER_COLUMNS = 'id, auth_id, name, email, handle, kyc_status, account_status, deleted_at, login_blocked_until, asaas_account_id'

  let user: { id: string; auth_id: string; name: string; email: string; handle: string; kyc_status: string; account_status: string; deleted_at: string | null; login_blocked_until: string | null; asaas_account_id: string | null } | null = null

  if (company_id && operator_ref) {
    if (!(await isCompanyMember(supabaseAdmin, company_id, operator_ref))) {
      console.error('[auth-login] FAIL:operator_not_member company_id=', company_id)
      return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
    }
    const { data } = await supabaseAdmin
      .from('users')
      .select(USER_COLUMNS)
      .eq('id', operator_ref)
      .maybeSingle()
    user = data
    console.log('[auth-login] lookup by operator_ref found=', !!user)
  } else {
    // ── Detectar tipo de identificador (CPF ou @handle) ─────────────────────
    const cpfClean    = normalizeCpf(cpf!)
    const handleClean = cpf!.replace(/^@/, '').toLowerCase()
    const isHandleId  = !validateCpf(cpfClean) && /^[a-z][a-z0-9_]{2,}$/.test(handleClean)

    if (!validateCpf(cpfClean) && !isHandleId) {
      console.error('[auth-login] FAIL:invalid_identifier')
      return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
    }

    if (isHandleId) {
      const { data } = await supabaseAdmin
        .from('users')
        .select(USER_COLUMNS)
        .eq('handle', handleClean)
        .maybeSingle()
      user = data
      console.log('[auth-login] lookup by handle=', handleClean, 'found=', !!user)
    } else {
      const cpfHashValue = await cpfHash(cpfClean)
      const { data } = await supabaseAdmin
        .from('users')
        .select(USER_COLUMNS)
        .eq('cpf', cpfHashValue)
        .maybeSingle()
      user = data
      console.log('[auth-login] lookup by cpf found=', !!user)
    }

    if (!user) {
      console.error('[auth-login] FAIL:user_not_found identifier=', isHandleId ? `@${handleClean}` : `cpf[${cpfClean.length}]`)
      return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
    }
  }

  if (!user) {
    console.error('[auth-login] FAIL:user_not_found operator_ref=', operator_ref)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  if (user.deleted_at) {
    console.error('[auth-login] FAIL:account_deleted user=', user.id)
    return err('ACCOUNT_DELETED', 'Esta conta foi excluída', 401)
  }

  // ── Bloqueio administrativo (Alber Admin: account_status = 'blocked') ───────
  // Contenção reversível feita pelo suporte. Resposta própria, sem revelar o motivo, antes de qualquer checagem de PIN.
  if (user.account_status === 'blocked') {
    console.error('[auth-login] FAIL:account_suspended user=', user.id)
    return err('ACCOUNT_SUSPENDED', 'Conta indisponível no momento. Fale com o suporte.', 403)
  }

  // ── Bloqueio temporário por tentativas excessivas (spec 05_security §2) ─────
  // 3 PINs errados ou 2 respostas de segurança erradas (contadas em
  // auth-question e aqui) bloqueiam o login por LOGIN_BLOCK_MINUTES.

  if (isCurrentlyBlocked(user.login_blocked_until)) {
    console.error('[auth-login] FAIL:account_blocked user=', user.id, 'until=', user.login_blocked_until)
    return blockedResponse(user.login_blocked_until!)
  }

  // ── Verificar PIN ─────────────────────────────────────────
  // O PIN fica em public.user_credentials (HMAC com pepper), nunca em app_metadata/JWT. Sem credenciais não há login.

  const { pinBcrypt, pinSha256 } = await loadPinCreds(supabaseAdmin, user.id)

  if (!pinBcrypt || !pinSha256) {
    console.error('[auth-login] credenciais de PIN ausentes para user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  let pinOk = false
  const pairs = tryParsePairsPayload(pin_hash)
  if (pairs) {
    // Modo pares (teclado embaralhado): testa as 64 combinações contra o HMAC guardado.
    pinOk = (await verifyPinWithPairs(pinSha256, pairs)).ok
  } else {
    // SHA-256 direto, ou o payload duplo { sha256, legacy } de clientes antigos (só o "sha256" vale: não há contas legadas).
    let hash = pin_hash
    try {
      const p = JSON.parse(pin_hash)
      if (typeof p?.sha256 === 'string') hash = p.sha256
    } catch { /* SHA-256 direto */ }
    pinOk = await pinMatches(hash, pinSha256)
  }

  if (!pinOk) {
    console.error('[auth-login] FAIL:pin_wrong')
    const { blocked, blockedUntil } = await recordFailureAndMaybeBlock(supabaseAdmin, user.id, 'pin_failed', PIN_FAILURE_THRESHOLD)
    if (blocked) return blockedResponse(blockedUntil!)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  // ── Verificar pergunta de segurança ───────────────────────────────────

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('id, position, question, answer_hash')
    .eq('user_id', user.id)
    .order('position')

  if (!questions || questions.length === 0) {
    console.error('[auth-login] no security questions for user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  const answerOk = (await Promise.all(
    questions.map(q => verifyAnswerHash(security_answer_hash, q.answer_hash))
  )).some(Boolean)

  if (!answerOk) {
    console.error('[auth-login] FAIL:security_answer_wrong user=', user.id)
    const { blocked, blockedUntil } = await recordFailureAndMaybeBlock(supabaseAdmin, user.id, 'security_question_failed', SECURITY_FAILURE_THRESHOLD)
    if (blocked) return blockedResponse(blockedUntil!)
    return err('WRONG_SECURITY_ANSWER', 'Resposta incorreta', 401)
  }

  // ── Gerar sessão JWT via Supabase Auth password flow ─────────────────────────

  const signInRes = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
      },
      body: JSON.stringify({ email: user.email, password: await sessionPassword(user.auth_id) }),
    },
  )

  if (!signInRes.ok) {
    const signInErr = await signInRes.json().catch(() => ({}))
    console.error('[auth-login] session creation failed:', signInErr)
    return err('SESSION_ERROR', 'Erro ao gerar sessão', 500)
  }

  const { access_token, refresh_token } = await signInRes.json() as {
    access_token: string
    refresh_token: string
  }

  await logAudit(supabaseAdmin, user.id, 'login_success', {})

  // Limpa um bloqueio já expirado (hygiene — o gate acima já ignora valores no passado)
  if (user.login_blocked_until) {
    await supabaseAdmin.from('users').update({ login_blocked_until: null }).eq('id', user.id)
  }

  return json({
    token:         access_token,
    refresh_token: refresh_token,
    user: {
      id:             user.id,
      name:           user.name,
      handle:         user.handle,
      email:          user.email,
      kyc_status:     user.kyc_status,
      account_status: user.account_status,
      has_personal_wallet: !!user.asaas_account_id,
    },
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
