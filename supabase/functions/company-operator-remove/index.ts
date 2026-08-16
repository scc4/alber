// Plano CNPJ (velvet-puzzling-sedgewick)
// POST /company-operator-remove
// Master (ou operador com permissions.gerenciar_operadores) revoga o acesso
// de um operador — ativo ou ainda com convite pendente (status 'invited').
// Marca status='banned' (mesmo padrão de lounge-remove-member) em vez de
// apagar a linha, para reter histórico/auditoria. Reversível: um novo convite
// por @handle ou link sobrescreve a linha de volta para 'invited'
// (company-operator-invite faz upsert e só bloqueia reconvite quando o
// status atual já é 'active').

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { requireCompanyPermission } from '../_shared/company-permissions.ts'

interface RemoveRequest {
  company_id:       string
  operator_user_id: string
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

  let body: RemoveRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  if (!body.company_id || !body.operator_user_id) {
    return err('MISSING_FIELDS', 'company_id e operator_user_id são obrigatórios', 400)
  }

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  if (body.operator_user_id === caller.id) {
    return err('CANNOT_REMOVE_SELF', 'Não é possível remover a si mesmo', 422)
  }

  // ── Validar permissão do caller para gerenciar operadores ────────────────────

  const access = await requireCompanyPermission(supabaseAdmin, caller.id, body.company_id, 'gerenciar_operadores')
  if (!access.ok) return err('FORBIDDEN', 'Sem permissão para remover operadores', 403)

  // ── Buscar operador alvo ──────────────────────────────────────────────────────

  const { data: operator } = await supabaseAdmin
    .from('company_operators')
    .select('id, status')
    .eq('company_id', body.company_id)
    .eq('user_id', body.operator_user_id)
    .maybeSingle()

  if (!operator) return err('OPERATOR_NOT_FOUND', 'Operador não encontrado nesta empresa', 404)
  if (operator.status === 'banned') return err('ALREADY_BANNED', 'Este operador já foi removido', 409)

  // ── Revogar: status='banned', permissões zeradas (defesa em profundidade —
  // requireCompanyPermission já exige status='active', mas zera de qualquer
  // forma para não deixar uma matriz liberada "pendurada" na linha) ───────────

  const { error: updateErr } = await supabaseAdmin
    .from('company_operators')
    .update({ status: 'banned', permissions: {} })
    .eq('id', operator.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'company-operator-remove', updateErr, {
      company_id: body.company_id, operator_user_id: body.operator_user_id,
    })
    return err('DB_ERROR', 'Erro ao remover operador', 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    body.operator_user_id,
    event_type: 'company_operator_removed',
    metadata:   { company_id: body.company_id, removed_by: caller.id },
  }).catch(() => {})

  return json({ company_id: body.company_id, operator_user_id: body.operator_user_id, status: 'banned' })
})
