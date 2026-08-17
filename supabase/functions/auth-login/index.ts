// Spec: /specs/03_backend.md §4.2
// Spec: /specs/05_security.md §2, §3, §4, §6

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../_shared/cpf.ts'
import { sha256hex, bcryptHash, bcryptVerify, verifyPinWithPairs, tryParsePairsPayload } from '../_shared/crypto.ts'
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
      console.error('[auth-login] FAIL:invalid_identifier raw=', cpf)
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
      const cpfHash = await sha256hex(cpfClean)
      const { data } = await supabaseAdmin
        .from('users')
        .select(USER_COLUMNS)
        .eq('cpf', cpfHash)
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

  // ── Bloqueio temporário por tentativas excessivas (spec 05_security §2) ─────
  // 3 PINs errados ou 2 respostas de segurança erradas (contadas em
  // auth-question e aqui) bloqueiam o login por LOGIN_BLOCK_MINUTES.

  if (isCurrentlyBlocked(user.login_blocked_until)) {
    console.error('[auth-login] FAIL:account_blocked user=', user.id, 'until=', user.login_blocked_until)
    return blockedResponse(user.login_blocked_until!)
  }

  // ── Verificar PIN ────────────────────────────────────────────────────────────

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user.auth_id)
  const pinBcrypt: string | undefined = authUser?.user?.app_metadata?.pin_bcrypt
  const pinSha256: string | undefined = authUser?.user?.app_metadata?.pin_sha256

  if (!pinBcrypt) {
    console.error('[auth-login] pin_bcrypt not found for user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  let pinOk          = false
  let resolvedPinHash = pin_hash
  let legacyMigration = false   // true quando conta foi registrada com dev-fallback hash

  const pairs = tryParsePairsPayload(pin_hash)
  console.log('[auth-login] pin_mode=', pairs ? 'pairs' : 'sha256',
    'pin_sha256_len=', pinSha256?.length ?? 0)

  if (pairs) {
    // ── Modo pares (fast login) ──────────────────────────────────────────────
    if (!pinSha256 || pinSha256.length !== 64) {
      console.warn('[auth-login] pin_sha256 ausente/inválido → PIN_SETUP_REQUIRED')
      return err('PIN_SETUP_REQUIRED', 'PIN_SETUP_REQUIRED', 401)
    }
    const result = await verifyPinWithPairs(pinSha256, pairs)
    console.log('[auth-login] verifyPinWithPairs ok=', result.ok)
    pinOk = result.ok
    if (result.sha256) resolvedPinHash = result.sha256

  } else {
    // ── Modo setup (SHA-256 direto ou payload de migração { sha256, legacy }) ─
    let dualPayload: { sha256: string; legacy: string } | null = null
    try {
      const p = JSON.parse(pin_hash)
      if (p?.sha256 && p?.legacy) dualPayload = p
    } catch { /* plain SHA-256 */ }

    if (dualPayload) {
      // Tenta hash real primeiro (conta nova com expo-crypto)
      pinOk = await bcryptVerify(dualPayload.sha256, pinBcrypt)
      if (pinOk) {
        resolvedPinHash = dualPayload.sha256
        console.log('[auth-login] bcryptVerify(sha256) ok=true')
      } else {
        // Tenta hash legado (conta registrada antes do expo-crypto)
        pinOk = await bcryptVerify(dualPayload.legacy, pinBcrypt)
        console.log('[auth-login] bcryptVerify(legacy) ok=', pinOk)
        if (pinOk) {
          resolvedPinHash  = dualPayload.sha256   // sessão usa hash real
          legacyMigration  = true
        }
      }
    } else {
      // Plain SHA-256 (sem payload de migração)
      pinOk = pinSha256 ? pin_hash === pinSha256 : await bcryptVerify(pin_hash, pinBcrypt)
      console.log('[auth-login] bcryptVerify(plain) ok=', pinOk, 'len=', pin_hash.length)
      if (pinOk && (!pinSha256 || pinSha256.length !== 64) && pin_hash.length === 64) {
        const { error: healError } = await supabaseAdmin.auth.admin.updateUserById(user.auth_id, {
          app_metadata: { ...(authUser?.user?.app_metadata ?? {}), pin_sha256: pin_hash },
        })
        if (healError) console.warn('[auth-login] pin_sha256 auto-heal failed:', healError.message)
        else console.log('[auth-login] pin_sha256 auto-heal ok')
      }
    }
  }

  if (!pinOk) {
    console.error('[auth-login] FAIL:pin_wrong')
    const { blocked, blockedUntil } = await recordFailureAndMaybeBlock(supabaseAdmin, user.id, 'pin_failed', PIN_FAILURE_THRESHOLD)
    if (blocked) return blockedResponse(blockedUntil!)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  // ── Verificar pergunta de segurança ──────────────────────────────────────────

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('id, position, question, answer_hash')
    .eq('user_id', user.id)
    .order('position')

  if (!questions || questions.length === 0) {
    console.error('[auth-login] no security questions for user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  const answerMatches = await Promise.all(
    questions.map(q => bcryptVerify(security_answer_hash, q.answer_hash))
  )
  let answerOk        = answerMatches.some(Boolean)
  let legacyAnswerIdx = -1

  if (!answerOk && security_answer_hash_legacy) {
    const legacyMatches = await Promise.all(
      questions.map(q => bcryptVerify(security_answer_hash_legacy, q.answer_hash))
    )
    answerOk        = legacyMatches.some(Boolean)
    legacyAnswerIdx = legacyMatches.findIndex(Boolean)
    if (answerOk) {
      console.log('[auth-login] security_answer matched via legacy hash (idx=', legacyAnswerIdx, ')')
      legacyMigration = true
    }
  }

  if (!answerOk) {
    console.error('[auth-login] FAIL:security_answer_wrong user=', user.id)
    const { blocked, blockedUntil } = await recordFailureAndMaybeBlock(supabaseAdmin, user.id, 'security_question_failed', SECURITY_FAILURE_THRESHOLD)
    if (blocked) return blockedResponse(blockedUntil!)
    return err('WRONG_SECURITY_ANSWER', 'Resposta incorreta', 401)
  }

  // ── Migração legada: atualizar credenciais com hash real ─────────────────────
  // Executa ANTES do signIn para garantir que a senha Supabase esteja correta.

  if (legacyMigration) {
    console.log('[auth-login] legacy migration: updating credentials')
    const newPinBcrypt = await bcryptHash(resolvedPinHash)
    const { error: migrErr } = await supabaseAdmin.auth.admin.updateUserById(user.auth_id, {
      password:     resolvedPinHash,
      app_metadata: {
        ...(authUser?.user?.app_metadata ?? {}),
        pin_bcrypt: newPinBcrypt,
        pin_sha256: resolvedPinHash,
      },
    })
    if (migrErr) console.warn('[auth-login] legacy PIN migration failed:', migrErr.message)
    else console.log('[auth-login] legacy PIN migration ok')

    // Migrar resposta de segurança do match legado
    if (legacyAnswerIdx >= 0 && security_answer_hash.length === 64) {
      const newAnswerBcrypt = await bcryptHash(security_answer_hash, 6)
      const { error: qErr } = await supabaseAdmin
        .from('security_questions')
        .update({ answer_hash: newAnswerBcrypt })
        .eq('id', questions[legacyAnswerIdx].id)
      if (qErr) console.warn('[auth-login] security question migration failed:', qErr.message)
      else console.log('[auth-login] security question', legacyAnswerIdx + 1, 'migrated')
    }
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
      body: JSON.stringify({ email: user.email, password: resolvedPinHash }),
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

  await logAudit(supabaseAdmin, user.id, 'login_success', { legacy_migration: legacyMigration })

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
