// Item 19 da revisão de QA (Consentimentos separados) — permite ligar/desligar
// o consentimento de marketing a qualquer momento, independente do cadastro
// (LGPD exige que o consentimento seja revogável). Preferência de baixo risco
// — não precisa de PIN/pergunta de segurança como handle/pix/PIN mudam.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

interface UpdateMarketingRequest {
  marketing_opt_in: boolean
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: UpdateMarketingRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  if (typeof body.marketing_opt_in !== 'boolean') {
    return err('MISSING_FIELDS', 'marketing_opt_in (boolean) é obrigatório', 400)
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, deleted_at')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user || user.deleted_at) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const { error: updateErr } = await supabaseAdmin
    .from('users')
    .update({
      marketing_opt_in:            body.marketing_opt_in,
      marketing_opt_in_updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[perfil-update-marketing] update error:', updateErr)
    return err('DB_ERROR', 'Erro ao atualizar preferência', 500)
  }

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    user.id,
      event_type: 'marketing_opt_in_changed',
      metadata:   { marketing_opt_in: body.marketing_opt_in },
    })
  } catch { /* não-crítico */ }

  return json({ marketing_opt_in: body.marketing_opt_in })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
