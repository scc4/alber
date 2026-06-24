import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { bcryptVerify, aesEncrypt, verifyPinWithPairs, tryParsePairsPayload } from '../_shared/crypto.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

type PixKeyType = 'cpf' | 'email' | 'phone' | 'random'

function isValidPixKey(key: string, type: PixKeyType): boolean {
  switch (type) {
    case 'cpf':    return /^\d{11}$/.test(key.replace(/\D/g, ''))
    case 'email':  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)
    case 'phone':  return /^\+?[\d\s()-]{10,15}$/.test(key)
    case 'random': return key.length > 10
    default:       return false
  }
}

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: { pix_key?: string; pix_key_type?: string; pin_hash?: string; security_answer_hash?: string }
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { pix_key, pix_key_type, pin_hash, security_answer_hash } = body

  if (!pix_key)              return err('MISSING_FIELDS', 'pix_key é obrigatório', 400)
  if (!pix_key_type)         return err('MISSING_FIELDS', 'pix_key_type é obrigatório', 400)
  if (!pin_hash)             return err('MISSING_FIELDS', 'pin_hash é obrigatório', 400)
  if (!security_answer_hash) return err('MISSING_FIELDS', 'security_answer_hash é obrigatório', 400)

  const validTypes: PixKeyType[] = ['cpf', 'email', 'phone', 'random']
  if (!validTypes.includes(pix_key_type as PixKeyType)) {
    return err('INVALID_PIX_TYPE', 'pix_key_type inválido', 400)
  }

  if (!isValidPixKey(pix_key, pix_key_type as PixKeyType)) {
    return err('INVALID_PIX_KEY', 'Chave Pix inválida para o tipo informado', 400)
  }

  // Buscar usuário
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, auth_id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // Verificar PIN
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
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'pix_change_pin_failed', metadata: {},
    }).catch(() => {})
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
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
    if (await bcryptVerify(security_answer_hash, q.answer_hash)) {
      securityOk = true
      break
    }
  }
  if (!securityOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'pix_change_security_failed', metadata: {},
    }).catch(() => {})
    return err('INVALID_CREDENTIALS', 'Resposta de segurança incorreta', 401)
  }

  // Encriptar chave Pix
  const aesSecret = Deno.env.get('ENCRYPTION_KEY')!
  let pixKeyEnc: string
  try {
    pixKeyEnc = await aesEncrypt(pix_key, aesSecret)
  } catch (e) {
    console.error('[perfil-update-pix] aes encrypt error:', e)
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // Atualizar
  const now = new Date().toISOString()
  const { error: updateErr } = await supabaseAdmin
    .from('users')
    .update({ pix_key: pixKeyEnc, pix_key_type, updated_at: now })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[perfil-update-pix] update error:', updateErr)
    return err('DB_ERROR', 'Erro ao atualizar chave Pix', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    user.id,
    event_type: 'pix_key_changed',
    metadata:   { pix_key_type },
  }).catch(() => {})

  return json({ success: true })
})
