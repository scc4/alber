// Spec: /specs/06_modules/split.md §5
// Fecha split variável: valida PIN, registra alocações finais, atualiza status.
//
// Regras:
//   - Somente o dono pode fechar
//   - Split deve estar aberto (status = 'open') e ser variável
//   - PIN verificado via bcrypt (padrão dos flows financeiros)
//   - final_amount registrado em split_participants por participante
//   - TODO: Asaas transfers para liquidação financeira real

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { bcryptVerify } from '../_shared/crypto.ts'
import { logError } from '../_shared/error-log.ts'

interface CloseRequest {
  split_id:    string
  allocations: Record<string, number>  // user_id → final_amount em Albers
  pin_hash:    string                  // SHA-256 do PIN (gerado no cliente)
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ─────────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Parse body ────────────────────────────────────────────────────────────────

  let body: CloseRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { split_id, allocations, pin_hash } = body

  if (!split_id)                              return err('MISSING_FIELDS', 'split_id é obrigatório', 400)
  if (!pin_hash)                              return err('MISSING_FIELDS', 'pin_hash é obrigatório', 400)
  if (!allocations || typeof allocations !== 'object')
    return err('MISSING_FIELDS', 'allocations é obrigatório', 400)

  // ── Buscar usuário ────────────────────────────────────────────────────────────

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, auth_id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (userErr || !user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Verificar PIN (spec §6: SHA-256 em trânsito, bcrypt no banco) ─────────────

  const { data: authMeta } = await supabaseAdmin.auth.admin.getUserById(user.auth_id)
  const pinBcrypt: string | undefined = authMeta?.user?.app_metadata?.pin_bcrypt

  if (!pinBcrypt) {
    console.error('[split-close] pin_bcrypt ausente para user:', user.id)
    return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
  }

  const pinOk = await bcryptVerify(pin_hash, pinBcrypt)
  if (!pinOk) {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    user.id,
      event_type: 'split_close_pin_failed',
      metadata:   { split_id },
    }).catch(() => {})
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
  }

  // ── Buscar e validar split ────────────────────────────────────────────────────

  const { data: split, error: splitErr } = await supabaseAdmin
    .from('splits')
    .select('id, name, type, status, owner_id, target_amount')
    .eq('id', split_id)
    .maybeSingle()

  if (splitErr || !split) return err('SPLIT_NOT_FOUND', 'Split não encontrado', 404)
  if (split.owner_id !== user.id)
    return err('FORBIDDEN', 'Somente o dono pode fechar o split', 403)
  if (split.status !== 'open')
    return err('SPLIT_CLOSED', 'Split já está fechado', 422)
  if (split.type !== 'variable')
    return err('INVALID_TYPE', 'Fechamento manual disponível apenas em splits variáveis', 422)

  // ── Registrar final_amount para cada participante ─────────────────────────────

  const now = new Date().toISOString()
  const allocationEntries = Object.entries(allocations)

  const updatePromises = allocationEntries.map(async ([userId, amount]) => {
    if (typeof amount !== 'number' || amount < 0) return

    await supabaseAdmin
      .from('split_participants')
      .update({ final_amount: amount, status: 'settled' })
      .eq('split_id', split_id)
      .eq('user_id', userId)
      .catch(e => console.error(`[split-close] final_amount update failed user=${userId}:`, e))

    // Registrar TX de liquidação
    await supabaseAdmin.from('transactions').insert({
      user_id:        userId,
      type:           'split_settle',
      amount,
      amount_brl:     amount,
      fee_amount:     0,
      status:         'completed',
      reference_id:   split_id,
      reference_type: 'split',
      metadata:       { split_id, split_name: split.name, final_amount: amount },
    }).catch(e => console.error(`[split-close] split_settle tx failed user=${userId}:`, e))
  })

  await Promise.allSettled(updatePromises)

  // TODO: Asaas transfers — liquidar blocked_amount residual de volta para cada
  // participante e transferir final_amount para a conta do dono.
  // Implementar em split-close v2 após split-settle-asaas Edge Function.

  // ── Fechar split ──────────────────────────────────────────────────────────────

  const { error: closeErr } = await supabaseAdmin
    .from('splits')
    .update({ status: 'closed', closed_at: now })
    .eq('id', split_id)

  if (closeErr) {
    await logError(supabaseAdmin, 'split-close', closeErr, { split_id })
    return err('DB_ERROR', 'Erro ao fechar split', 500)
  }

  // ── Audit log ─────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    user.id,
    event_type: 'split_closed',
    metadata:   { split_id, participant_count: allocationEntries.length },
  }).catch(() => {})

  return json({ split_id, status: 'closed', closed_at: now })
})
