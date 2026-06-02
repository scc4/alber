// Spec: /specs/06_modules/split.md §11.1, §11.2
// Lança item de conta em split variável (somente dono).
//
// Regras (SP-15, SP-16, SP-17):
//   - Divisão igualitária entre TODOS os participantes aceitos
//   - Débito imediato do blocked_amount de cada participante no DB
//   - Bloqueio real (Asaas) liquidado no fechamento do split
//   - Lançamento bloqueado se ultrapassar o teto (target_amount)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

interface LaunchRequest {
  split_id:    string
  description: string
  value:       number
  photo_url?:  string
}

interface ParticipantRow { id: string; user_id: string; blocked_amount: number }

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

  let body: LaunchRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { split_id, description, value, photo_url } = body

  if (!split_id)            return err('MISSING_FIELDS', 'split_id é obrigatório', 400)
  if (!description?.trim()) return err('MISSING_FIELDS', 'Descrição é obrigatória', 400)
  if (typeof value !== 'number' || value <= 0)
    return err('INVALID_AMOUNT', 'Valor deve ser maior que zero', 400)

  // ── Buscar usuário ────────────────────────────────────────────────────────────

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, handle')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (userErr || !user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Buscar e validar split ────────────────────────────────────────────────────

  const { data: split, error: splitErr } = await supabaseAdmin
    .from('splits')
    .select('id, name, type, target_amount, owner_id, status')
    .eq('id', split_id)
    .maybeSingle()

  if (splitErr || !split) return err('SPLIT_NOT_FOUND', 'Split não encontrado', 404)
  if (split.owner_id !== user.id)
    return err('FORBIDDEN', 'Somente o dono pode lançar itens', 403)
  if (split.status !== 'open')
    return err('SPLIT_CLOSED', 'Split não está ativo', 422)
  if (split.type !== 'variable')
    return err('INVALID_TYPE', 'Lançamentos disponíveis apenas em splits variáveis', 422)

  // ── Verificar teto (SP-17): total lançado + novo valor ≤ target_amount ────────

  const { data: existingItems } = await supabaseAdmin
    .from('split_items')
    .select('value')
    .eq('split_id', split_id)

  const totalLaunched = parseFloat(
    (existingItems?.reduce((s, i) => s + Number(i.value), 0) ?? 0).toFixed(2),
  )
  const valueRounded  = parseFloat(value.toFixed(2))
  const newTotal      = parseFloat((totalLaunched + valueRounded).toFixed(2))

  if (newTotal > Number(split.target_amount)) {
    return err(
      'EXCEEDS_TARGET',
      `Lançamento ultrapassaria o teto de ${split.target_amount} Albers. ` +
      `Total lançado: ${totalLaunched.toFixed(2)} | Restante: ${(Number(split.target_amount) - totalLaunched).toFixed(2)}`,
      422,
    )
  }

  // ── Buscar participantes aceitos ──────────────────────────────────────────────

  const { data: participants, error: partErr } = await supabaseAdmin
    .from('split_participants')
    .select('id, user_id, blocked_amount')
    .eq('split_id', split_id)
    .eq('status', 'accepted')

  if (partErr || !participants?.length) {
    await logError(supabaseAdmin, 'split-launch', partErr ?? new Error('no_participants'), { split_id })
    return err('DB_ERROR', 'Erro ao buscar participantes', 500)
  }

  const participantCount = participants.length
  const perPerson        = parseFloat((valueRounded / participantCount).toFixed(2))

  // ── Verificar que todos têm blocked_amount suficiente ────────────────────────

  const insufficient = (participants as ParticipantRow[]).filter(
    p => parseFloat(Number(p.blocked_amount).toFixed(2)) < perPerson,
  )

  if (insufficient.length > 0) {
    return err(
      'INSUFFICIENT_BLOCKED',
      `${insufficient.length} participante(s) não têm saldo reservado suficiente ` +
      `para este lançamento (necessário: ${perPerson.toFixed(2)} Albers cada)`,
      422,
    )
  }

  // ── Inserir split_item ────────────────────────────────────────────────────────

  const { data: splitItem, error: itemErr } = await supabaseAdmin
    .from('split_items')
    .insert({
      split_id,
      description:       description.trim(),
      value:             valueRounded,
      value_per_person:  perPerson,
      participant_count: participantCount,
      photo_url:         photo_url ?? null,
    })
    .select('id')
    .single()

  if (itemErr || !splitItem) {
    await logError(supabaseAdmin, 'split-launch', itemErr ?? new Error('item_insert_failed'), { split_id })
    return err('DB_ERROR', 'Erro ao registrar lançamento', 500)
  }

  const itemId = splitItem.id

  // ── Debitar de cada participante (SP-15) ──────────────────────────────────────
  // Modelo: débito virtual — reduz blocked_amount no DB + registra split_debit TX.
  // Asaas transfers ocorrem no fechamento do split (split_close), não aqui,
  // porque split.type === 'variable' tem "Débito | No fechamento" no modelo base.

  const debits = (participants as ParticipantRow[]).map(async (p) => {
    const newBlocked = parseFloat((Number(p.blocked_amount) - perPerson).toFixed(2))

    await supabaseAdmin
      .from('split_participants')
      .update({ blocked_amount: newBlocked })
      .eq('id', p.id)
      .catch(e => console.error(`[split-launch] blocked update failed user=${p.user_id}:`, e))

    await supabaseAdmin.from('transactions').insert({
      user_id:        p.user_id,
      type:           'split_debit',
      amount:         perPerson,
      amount_brl:     perPerson,
      fee_amount:     0,
      status:         'completed',
      reference_id:   split_id,
      reference_type: 'split',
      metadata: {
        split_id,
        split_item_id:    itemId,
        description:      description.trim(),
        item_total_value: valueRounded,
        participant_count: participantCount,
      },
    }).catch(e => console.error(`[split-launch] split_debit tx failed user=${p.user_id}:`, e))
  })

  await Promise.allSettled(debits)

  // ── Push para todos os participantes (exceto dono) — SP-16 ───────────────────

  const pushes = (participants as ParticipantRow[])
    .filter(p => p.user_id !== user.id)
    .map(p =>
      sendPush(
        p.user_id,
        `Novo lançamento: ${description.trim()}`,
        `${user.handle} lançou R$ ${valueRounded.toFixed(2)} — sua parte: R$ ${perPerson.toFixed(2)}`,
      ),
    )
  await Promise.allSettled(pushes)

  // ── Audit log ─────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    user.id,
    event_type: 'split_launch',
    metadata:   { split_id, item_id: itemId, value: valueRounded, per_person: perPerson, participant_count: participantCount },
  }).catch(() => {})

  const remainingBudget = parseFloat((Number(split.target_amount) - newTotal).toFixed(2))

  return json({
    item_id:           itemId,
    description:       description.trim(),
    value:             valueRounded,
    value_per_person:  perPerson,
    participant_count: participantCount,
    total_launched:    newTotal,
    remaining_budget:  remainingBudget,
  }, 201)
})
