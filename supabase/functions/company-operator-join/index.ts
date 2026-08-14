// Plano CNPJ (velvet-puzzling-sedgewick)
// POST /company-operator-join
// Usuário convidado (company_operators.status='invited') aceita e passa a
// operar a empresa (status='active'). Não existe fluxo de "pedir para
// entrar" em empresas — diferente do Lounge, aqui só o master convida.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface JoinRequest {
  company_id: string
}

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

  let body: JoinRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.company_id) return err('MISSING_FIELDS', 'company_id é obrigatório', 400)

  // ── Buscar usuário ──────────────────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Verificar convite ─────────────────────────────────────────────────────────

  const { data: operator } = await supabaseAdmin
    .from('company_operators')
    .select('id, status')
    .eq('company_id', body.company_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!operator) return err('NOT_INVITED', 'Nenhum convite encontrado para esta empresa', 404)
  if (operator.status === 'active') return err('ALREADY_OPERATOR', 'Você já opera esta empresa', 422)
  if (operator.status !== 'invited') {
    return err('INVITE_UNAVAILABLE', 'Este convite não está mais disponível', 403)
  }

  const { error: updateErr } = await supabaseAdmin
    .from('company_operators')
    .update({ status: 'active', joined_at: new Date().toISOString() })
    .eq('id', operator.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'company-operator-join', updateErr, { company_id: body.company_id })
    return err('DB_ERROR', 'Erro ao aceitar convite', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    user.id,
    event_type: 'company_operator_joined',
    metadata:   { company_id: body.company_id },
  }).catch(() => {})

  return json({ status: 'active', company_id: body.company_id })
})
