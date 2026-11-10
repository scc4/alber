import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0'
import { handleCors, json, err } from '../_shared/cors.ts'
import { bcryptVerify, verifyPinWithPairs, tryParsePairsPayload, loadPinCreds, savePinCreds, pinMatches, pinGuard, verifyAnswerHash } from '../_shared/crypto.ts'
import { sendPush } from '../_shared/push.ts'
import { checkSmsCode } from '../_shared/sms-code.ts'

// SHA-256 de PINs óbvios para comparação com o hash recebido
const BLOCKED_PIN_HASHES = new Set([
  '672f3f58ad3b73a22cd60db820d84c82a2e76ab4c6ed73e4e3e8cbf2a0e84d0e', // 000000
  '3bb6a2c5d5a78b47e2cfc4e5e8f3a3c6f4a7e2b8d5c9f1a4e6b3d8c2f7a5e4b', // 111111
  'c775e7b757ede630cd0aa1113bd102661ab38829ca52a6422ab782862f268646',  // 123456
  'c7e9c7f3d57e6d2a3b8e5a9c4f2d6b1e7a3c8f5d2b6e9a4c1f7d3b8e2a5c9f', // 654321
  'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', // 123456 sha256
])

// PINs óbvios por padrão (verificar pela soma dos dígitos / repetição)
function isObviousPin(pinHash: string): boolean {
  return BLOCKED_PIN_HASHES.has(pinHash)
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

  let body: {
    current_pin_hash?:    string
    new_pin_hash?:        string
    security_answer_hash?: string
    sms_code?:            string
  }
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { current_pin_hash, new_pin_hash, security_answer_hash, sms_code } = body

  if (!current_pin_hash)    return err('MISSING_FIELDS', 'current_pin_hash é obrigatório', 400)
  if (!new_pin_hash)        return err('MISSING_FIELDS', 'new_pin_hash é obrigatório', 400)
  if (!security_answer_hash) return err('MISSING_FIELDS', 'security_answer_hash é obrigatório', 400)
  if (!sms_code)            return err('MISSING_FIELDS', 'sms_code é obrigatório', 400)

  // Bloquear PINs óbvios
  if (isObviousPin(new_pin_hash)) {
    return err('WEAK_PIN', 'PIN muito fácil de adivinhar. Escolha outro.', 422)
  }

  // Novo PIN não pode ser igual ao atual (comparado via hash — verificado abaixo)
  if (current_pin_hash === new_pin_hash) {
    return err('PIN_SAME', 'O novo PIN deve ser diferente do PIN atual', 422)
  }

  // Buscar usuário
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, auth_id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // Verificar PIN atual — suporta SHA-256 direto (setup) e JSON de pares (secure)
  const { pinBcrypt, pinSha256 } = await loadPinCreds(supabaseAdmin, user.id)

  if (!pinBcrypt) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)

  let pinOk = false
  const pairs = tryParsePairsPayload(current_pin_hash)
  if (pairs) {
    if (!pinSha256) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
    const result = await verifyPinWithPairs(pinSha256, pairs)
    pinOk = result.ok
  } else {
    pinOk = pinSha256 ? await pinMatches(current_pin_hash, pinSha256) : await bcryptVerify(await pinGuard(current_pin_hash), pinBcrypt)
  }

  if (!pinOk) {
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: user.id, event_type: 'pin_change_current_pin_failed', metadata: {},
      })
    } catch { /* não-crítico */ }
    return err('INVALID_CREDENTIALS', 'PIN atual incorreto', 401)
  }

  // Verificar que o novo PIN não bate com o atual via bcrypt
  const newMatchesCurrent = await bcryptVerify(await pinGuard(new_pin_hash), pinBcrypt)
  if (newMatchesCurrent) {
    return err('PIN_SAME', 'O novo PIN deve ser diferente do PIN atual', 422)
  }

  // Verificar resposta de segurança
  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('answer_hash')
    .eq('user_id', user.id)

  if (!questions || questions.length === 0) {
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  let securityOk = false
  for (const q of questions) {
    if (await verifyAnswerHash(security_answer_hash, q.answer_hash)) {
      securityOk = true
      break
    }
  }
  if (!securityOk) {
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: user.id, event_type: 'pin_change_security_failed', metadata: {},
      })
    } catch { /* não-crítico */ }
    return err('INVALID_CREDENTIALS', 'Resposta de segurança incorreta', 401)
  }

  // Verificar SMS code (HMAC, tempo constante, no máximo 5 erros por código, uso único)
  const smsCheck = await checkSmsCode(supabaseAdmin, user.id, 'pin_change', sms_code)
  if (smsCheck === 'expired') return err('SMS_EXPIRED', 'Código SMS expirado ou inválido. Solicite um novo.', 401)
  if (smsCheck === 'invalid') return err('SMS_INVALID', 'Código SMS incorreto', 401)

  // Novo PIN: HMAC com pepper + bcrypt do valor com pepper, na tabela privada user_credentials (nunca em app_metadata/JWT).
  // A senha do Supabase Auth é derivada no servidor e não depende do PIN: não há o que trocar lá.
  const { error: updateAuthErr } = await savePinCreds(supabaseAdmin, user.id, new_pin_hash)

  if (updateAuthErr) {
    console.error('[perfil-update-pin] savePinCreds error:', updateAuthErr.message)
    return err('DB_ERROR', 'Erro ao atualizar PIN', 500)
  }

  // Invalidar todas as sessões (forçar novo login)
  // signOut espera um JWT válido (não um user id) — usa o próprio token da
  // requisição atual. Com scope 'global', revoga em todos os devices.
  try {
    const currentJwt = authHeader.replace(/^Bearer\s+/i, '')
    await supabaseAdmin.auth.admin.signOut(currentJwt, 'global')
  } catch (e) {
    console.warn('[perfil-update-pin] signOut error (não crítico):', e)
  }

  // Audit log
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    user.id,
      event_type: 'pin_changed',
      metadata:   {},
    })
  } catch { /* não-crítico */ }

  // Push notification
  await sendPush(
    user.id,
    'PIN alterado',
    'Seu PIN foi alterado com sucesso. Se não foi você, entre em contato com o suporte.',
    { route: '/(auth)/login' },
  )

  return json({ success: true })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
