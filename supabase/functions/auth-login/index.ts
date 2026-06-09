// Spec: /specs/03_backend.md §4.2
// Spec: /specs/05_security.md §2, §3, §4, §6

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../_shared/cpf.ts'
import { sha256hex, bcryptVerify, verifyPinWithPairs, tryParsePairsPayload } from '../_shared/crypto.ts'

interface LoginRequest {
  cpf: string
  pin_hash: string
  security_answer_hash: string
}

// Janela de bloqueio e máximo de tentativas (spec 05_security §2)
const MAX_ATTEMPTS   = 3
const WINDOW_MINUTES = 15

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logAudit(
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

async function failedAttempts(userId: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('event_type', ['login_failed', 'pin_failed'])
    .gte('created_at', since)
  return count ?? 0
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  let body: LoginRequest
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { cpf, pin_hash, security_answer_hash } = body

  if (!cpf || !pin_hash || !security_answer_hash) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }

  // ── Validar e normalizar CPF ─────────────────────────────────────────────────

  const cpfClean = normalizeCpf(cpf)
  if (!validateCpf(cpfClean)) {
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  const cpfHash = await sha256hex(cpfClean)

  // ── Localizar usuário ────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, auth_id, name, email, handle, kyc_status, account_status')
    .eq('cpf', cpfHash)
    .maybeSingle()

  if (!user) {
    // Não revelar se o CPF existe ou não
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  // ── Rate limiting (spec 05_security §2: 3 tentativas → bloqueio 15 min) ──────

  const attempts = await failedAttempts(user.id)
  if (attempts >= MAX_ATTEMPTS) {
    await logAudit(user.id, 'pin_blocked', { attempts })
    return err(
      'TOO_MANY_ATTEMPTS',
      `Conta bloqueada por ${WINDOW_MINUTES} minutos após tentativas excessivas`,
      429,
    )
  }

  // ── Verificar PIN ────────────────────────────────────────────────────────────
  // pin_hash = SHA-256(digits) enviado pelo app
  // pin_bcrypt = bcrypt(pin_hash) armazenado no app_metadata

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user.auth_id)
  const pinBcrypt: string | undefined = authUser?.user?.app_metadata?.pin_bcrypt
  const pinSha256: string | undefined = authUser?.user?.app_metadata?.pin_sha256

  if (!pinBcrypt) {
    console.error('pin_bcrypt not found for user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  // Detectar modo: JSON de pares (secure) vs SHA-256 direto (setup/legacy)
  let pinOk = false
  let resolvedPinHash = pin_hash // SHA-256 usado para criar a sessão Supabase
  const pairs = tryParsePairsPayload(pin_hash)
  if (pairs) {
    if (!pinSha256) {
      console.error('pin_sha256 not found for user (conta criada antes desta versão):', user.id)
      return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
    }
    const result = await verifyPinWithPairs(pinSha256, pairs)
    pinOk = result.ok
    if (result.sha256) resolvedPinHash = result.sha256
  } else {
    pinOk = await bcryptVerify(pin_hash, pinBcrypt)
  }

  if (!pinOk) {
    await logAudit(user.id, 'pin_failed', { attempts: attempts + 1 })
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  // ── Verificar pergunta de segurança ──────────────────────────────────────────
  // Spec 05_security §3: sorteia 1 de 4 perguntas aleatoriamente.
  // O app envia o hash da resposta à pergunta que escolheu mostrar.
  // O BFF verifica contra todas as 4 hashes armazenadas.
  // Qualquer match = autenticação válida para MVP.

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('answer_hash')
    .eq('user_id', user.id)

  if (!questions || questions.length === 0) {
    console.error('No security questions found for user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  const answerMatches = await Promise.all(
    questions.map(q => bcryptVerify(security_answer_hash, q.answer_hash))
  )
  const answerOk = answerMatches.some(Boolean)

  if (!answerOk) {
    await logAudit(user.id, 'security_question_failed', {})
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  // ── Sucesso — gerar sessão JWT via Supabase Auth password flow ───────────────

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

  await logAudit(user.id, 'login_success', {})

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
    },
  })
})
