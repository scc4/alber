// Fase 2 do login: verifica PIN e retorna opções de múltipla escolha mascaradas.
// Não retorna a resposta em texto — apenas sha256 hash + exibição mascarada de cada opção.
// O hash da opção selecionada é enviado diretamente ao auth-login para validação bcrypt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../_shared/cpf.ts'
import { sha256hex, tryParsePairsPayload, verifyPinWithPairs, bcryptVerify } from '../_shared/crypto.ts'
import { isCurrentlyBlocked, recordFailureAndMaybeBlock, PIN_FAILURE_THRESHOLD } from '../_shared/login-lockout.ts'

// ── Mascaramento e geração de decoys (espelhado de utils/crypto.ts) ──────────

function maskAnswer(answer: string): string {
  const n = answer.length
  if (n <= 4)  return answer[0] + '*'.repeat(Math.max(0, n - 2)) + answer[n - 1]
  if (n <= 8)  return answer.slice(0, 2) + '*'.repeat(n - 4) + answer.slice(n - 2)
  return answer.slice(0, 3) + '*'.repeat(n - 6) + answer.slice(n - 3)
}

const DECOY_POOL = [
  'rex', 'nina', 'mel', 'luna', 'bob', 'lola', 'toto', 'bidu', 'fofo', 'pingo',
  'maria', 'ana', 'clara', 'luisa', 'sofia', 'julia', 'camila', 'rita', 'rosa', 'bianca',
  'pedro', 'paulo', 'joao', 'jose', 'carlos', 'lucas', 'mateus', 'rafael', 'thiago', 'igor',
  'campinas', 'santos', 'bauru', 'jundiai', 'osasco', 'taubate', 'piracicaba',
  'brasilia', 'salvador', 'fortaleza', 'recife', 'curitiba', 'manaus',
  'palmeiras', 'girassol', 'acacia', 'lirio', 'orquidea',
]

function generateDecoys(realAnswer: string, count: number): string[] {
  const real = realAnswer.toLowerCase()
  const targetLen = real.length
  const pool = DECOY_POOL.filter(d => d !== real)
  const nearby = pool.filter(d => Math.abs(d.length - targetLen) <= 3)
  const source = nearby.length >= count ? nearby : pool
  return [...source].sort(() => Math.random() - 0.5).slice(0, count)
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return json({ question: '', options: [] })

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: { identifier: string; pin_hash: string; exclude_question_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ question: '', options: [] })
  }

  const { identifier, pin_hash, exclude_question_id } = body
  if (!identifier || !pin_hash) return json({ question: '', options: [] })

  // ── Localizar usuário ────────────────────────────────────────────────────────

  const cpfClean    = normalizeCpf(identifier)
  const handleClean = identifier.replace(/^@/, '').toLowerCase()
  const isHandleId  = !validateCpf(cpfClean) && /^[a-z][a-z0-9_]{2,}$/.test(handleClean)

  if (!validateCpf(cpfClean) && !isHandleId) return json({ question: '', options: [] })

  let userId: string | null = null
  let authId: string | null = null
  let loginBlockedUntil: string | null = null

  if (isHandleId) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, auth_id, login_blocked_until')
      .eq('handle', handleClean)
      .maybeSingle()
    userId = data?.id ?? null
    authId = data?.auth_id ?? null
    loginBlockedUntil = data?.login_blocked_until ?? null
  } else {
    const cpfHash = await sha256hex(cpfClean)
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, auth_id, login_blocked_until')
      .eq('cpf', cpfHash)
      .maybeSingle()
    userId = data?.id ?? null
    authId = data?.auth_id ?? null
    loginBlockedUntil = data?.login_blocked_until ?? null
  }

  if (!userId || !authId) return json({ question: '', options: [] })

  // ── Bloqueio temporário por tentativas excessivas (ver _shared/login-lockout) ─
  // Checa ANTES de tentar o PIN — não adianta nem tentar enquanto bloqueado.

  if (isCurrentlyBlocked(loginBlockedUntil)) {
    return json({ question: '', options: [], blocked: true, blocked_until: loginBlockedUntil })
  }

  // ── Verificar PIN (falha é logada e contada aqui — este costuma ser o único
  //    lugar onde um PIN errado é de fato detectado no fluxo real de login) ───

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(authId)
  const pinBcrypt: string | undefined = authUser?.user?.app_metadata?.pin_bcrypt
  const pinSha256: string | undefined = authUser?.user?.app_metadata?.pin_sha256

  if (!pinBcrypt) return json({ question: '', options: [] })

  let pinOk = false
  const pairs = tryParsePairsPayload(pin_hash)

  if (pairs) {
    if (!pinSha256 || pinSha256.length !== 64) {
      // pin_sha256 ausente — conta registrada antes do fast-login; cliente deve usar modo setup
      return json({ question: '', options: [], pin_setup_required: true })
    }
    const result = await verifyPinWithPairs(pinSha256, pairs)
    pinOk = result.ok
  } else {
    // Verificar dual payload { sha256, legacy } (enviado pelo PINInput em legacyCompat=true)
    let dualPayload: { sha256: string; legacy: string } | null = null
    try {
      const p = JSON.parse(pin_hash)
      if (p?.sha256 && p?.legacy) dualPayload = p
    } catch { /* plain SHA-256 */ }

    if (dualPayload) {
      pinOk = await bcryptVerify(dualPayload.sha256, pinBcrypt)
      if (!pinOk) pinOk = await bcryptVerify(dualPayload.legacy, pinBcrypt)
    } else {
      pinOk = await bcryptVerify(pin_hash, pinBcrypt)
    }
  }

  if (!pinOk) {
    const { blocked, blockedUntil } = await recordFailureAndMaybeBlock(supabaseAdmin, userId, 'pin_failed', PIN_FAILURE_THRESHOLD)
    if (blocked) return json({ question: '', options: [], blocked: true, blocked_until: blockedUntil })
    return json({ question: '', options: [], pin_invalid: true })
  }

  // ── Buscar pergunta e answer_normalized ──────────────────────────────────────

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('id, position, question, answer_sha256, answer_normalized')
    .eq('user_id', userId)
    .order('position')

  if (!questions || questions.length === 0) return json({ question: '', options: [] })

  // Sorteia aleatoriamente entre as perguntas que têm answer_sha256 — evita
  // repetir exclude_question_id (pergunta que acabou de ser respondida
  // errado), a menos que seja a única opção elegível.
  let eligible = questions.filter(q => q.answer_sha256)
  if (exclude_question_id && eligible.length > 1) {
    const withoutExcluded = eligible.filter(q => q.id !== exclude_question_id)
    if (withoutExcluded.length > 0) eligible = withoutExcluded
  }
  if (eligible.length === 0) {
    const first = questions[0]
    return json({ question: first?.question ?? '', options: [] })
  }
  const row = eligible[Math.floor(Math.random() * eligible.length)]

  const realSha256    = row.answer_sha256    as string
  const answerNorm    = (row.answer_normalized as string | null) ?? ''

  // ── Gerar opções: hash real do banco + decoys com sha256 próprio ─────────────

  const decoys = generateDecoys(answerNorm || 'resposta', 4)

  const decoyOptions = await Promise.all(
    decoys.map(async text => ({
      hash:    await sha256hex(text),
      display: maskAnswer(text),
    }))
  )

  const options = [
    { hash: realSha256, display: maskAnswer(answerNorm || '***') },
    ...decoyOptions,
  ]

  // Embaralha para que a opção real não fique sempre na posição 0
  const shuffled = [...options].sort(() => Math.random() - 0.5)

  return json({
    question:    row.question as string,
    question_id: row.id as string,
    options:     shuffled,
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
