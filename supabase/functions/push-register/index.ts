// POST /push-register
// Body: { token: string, platform: 'ios'|'android' }
// UPSERT do Expo Push Token na tabela push_tokens.
// Chamado após login/splash com token do usuário autenticado.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ────────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Parse body ──────────────────────────────────────────────────────────────

  let body: { token: string; platform: string }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { token, platform } = body
  if (!token || !platform) return err('MISSING_FIELDS', 'token e platform são obrigatórios', 400)
  if (!['ios', 'android'].includes(platform)) return err('INVALID_PLATFORM', 'platform deve ser ios ou android', 400)

  // ── Buscar user_id ──────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── UPSERT token ─────────────────────────────────────────────────────────────

  const { error: upsertErr } = await supabaseAdmin
    .from('push_tokens')
    .upsert(
      { user_id: user.id, token, platform, active: true },
      { onConflict: 'user_id,token' },
    )

  if (upsertErr) {
    console.error('[push-register] upsert failed:', upsertErr)
    return err('DB_ERROR', 'Erro ao registrar token', 500)
  }

  return json({ success: true })
})
