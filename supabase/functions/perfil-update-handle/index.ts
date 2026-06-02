import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { bcryptVerify } from '../_shared/crypto.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const HANDLE_REGEX = /^[a-z0-9_.]{3,30}$/

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

  let body: { new_handle?: string; pin_hash?: string; security_answer_hash?: string }
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { new_handle, pin_hash, security_answer_hash } = body

  if (!new_handle)            return err('MISSING_FIELDS', 'new_handle é obrigatório', 400)
  if (!pin_hash)              return err('MISSING_FIELDS', 'pin_hash é obrigatório', 400)
  if (!security_answer_hash)  return err('MISSING_FIELDS', 'security_answer_hash é obrigatório', 400)

  const handleClean = new_handle.toLowerCase().replace(/^@/, '')
  if (!HANDLE_REGEX.test(handleClean)) {
    return err('INVALID_HANDLE', 'Handle inválido. Use letras, números, _ ou . (3-30 caracteres)', 400)
  }

  // Buscar usuário
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, auth_id, handle, handle_updated_at')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // Cooldown de 30 dias
  if (user.handle_updated_at) {
    const lastUpdate = new Date(user.handle_updated_at).getTime()
    const daysSince  = (Date.now() - lastUpdate) / (1000 * 60 * 60 * 24)
    if (daysSince < 30) {
      const nextAllowed = new Date(lastUpdate + 30 * 24 * 60 * 60 * 1000).toISOString()
      return err('HANDLE_COOLDOWN', 'Handle pode ser alterado apenas uma vez a cada 30 dias', 422, { next_allowed_at: nextAllowed })
    }
  }

  // Verificar PIN
  const { data: authMeta } = await supabaseAdmin.auth.admin.getUserById(user.auth_id)
  const pinBcrypt: string | undefined = authMeta?.user?.app_metadata?.pin_bcrypt

  if (!pinBcrypt) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)

  const pinOk = await bcryptVerify(pin_hash, pinBcrypt)
  if (!pinOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id, event_type: 'handle_change_pin_failed', metadata: {},
    }).catch(() => {})
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
  }

  // Verificar resposta de segurança (qualquer das 4 perguntas)
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
      user_id: user.id, event_type: 'handle_change_security_failed', metadata: {},
    }).catch(() => {})
    return err('INVALID_CREDENTIALS', 'Resposta de segurança incorreta', 401)
  }

  // Verificar disponibilidade
  const newHandleWithAt = '@' + handleClean
  if (user.handle === newHandleWithAt) {
    return err('HANDLE_SAME', 'Este já é o seu handle atual', 422)
  }

  const { count: taken } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('handle', newHandleWithAt)

  if ((taken ?? 0) > 0) {
    return err('HANDLE_TAKEN', 'Handle indisponível. Escolha outro.', 422)
  }

  // Atualizar
  const now = new Date().toISOString()
  const { error: updateErr } = await supabaseAdmin
    .from('users')
    .update({ handle: newHandleWithAt, handle_updated_at: now, updated_at: now })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[perfil-update-handle] update error:', updateErr)
    return err('DB_ERROR', 'Erro ao atualizar handle', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    user.id,
    event_type: 'handle_changed',
    metadata:   { old_handle: user.handle, new_handle: newHandleWithAt },
  }).catch(() => {})

  return json({ success: true, handle: newHandleWithAt })
})
