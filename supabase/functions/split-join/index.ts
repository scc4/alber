// Spec: /specs/06_modules/split.md §4, §6, §11.3
// Ingresso em split via invite_token.
//
// Fixed:
//   - Débito imediato: Asaas transfer participante → dono (SP-01)
//   - Auto-close quando todos aderiram (SP-06)
//
// Variable:
//   - Asaas transfer imediato participante → dono (SP-02 — dinheiro real ao entrar)
//   - blocked_amount = total pago ao dono (não diminui com lançamentos)
//   - §11.3: recalcula, devolve excedente real (dono → participantes existentes)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt } from '../_shared/crypto.ts'
import { transferToWallet, getSubcontaBalance, AsaasError } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

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

  let body: { invite_token?: string }
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { invite_token } = body
  if (!invite_token) return err('MISSING_FIELDS', 'invite_token é obrigatório', 400)

  // ── Buscar usuário que está entrando ─────────────────────────────────────────

  const { data: joiner, error: joinerErr } = await supabaseAdmin
    .from('users')
    .select('id, handle, name, asaas_api_key_enc')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (joinerErr || !joiner) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Buscar split pelo token ───────────────────────────────────────────────────

  const { data: split, error: splitErr } = await supabaseAdmin
    .from('splits')
    .select('id, name, type, target_amount, max_participants, owner_id, status, invite_expires_at')
    .eq('invite_token', invite_token)
    .maybeSingle()

  if (splitErr || !split) return err('SPLIT_NOT_FOUND', 'Convite não encontrado', 404)
  if (split.status !== 'open')
    return err('SPLIT_CLOSED', 'Este split não está mais ativo', 422)
  if (new Date(split.invite_expires_at) < new Date())
    return err('SPLIT_EXPIRED', 'Link de convite expirado', 422)
  if (split.owner_id === joiner.id)
    return err('ALREADY_PARTICIPANT', 'Você já é o dono deste split', 422)

  // ── Verificar duplicidade ─────────────────────────────────────────────────────

  const { data: existing } = await supabaseAdmin
    .from('split_participants')
    .select('id')
    .eq('split_id', split.id)
    .eq('user_id', joiner.id)
    .maybeSingle()

  if (existing) return err('ALREADY_PARTICIPANT', 'Você já é participante deste split', 422)

  // ── Buscar participantes aceitos ──────────────────────────────────────────────

  const { data: currentParticipants, error: partListErr } = await supabaseAdmin
    .from('split_participants')
    .select('id, user_id, blocked_amount')
    .eq('split_id', split.id)
    .eq('status', 'accepted')

  if (partListErr) {
    await logError(supabaseAdmin, 'split-join', partListErr, { split_id: split.id })
    return err('DB_ERROR', 'Erro ao verificar participantes', 500)
  }

  const acceptedCount = currentParticipants?.length ?? 0

  if (split.max_participants && acceptedCount >= split.max_participants) {
    return err('SPLIT_FULL', 'Split atingiu o máximo de participantes', 422)
  }

  // ── Calcular valor (fixo ou variável) ─────────────────────────────────────────

  let amountForJoiner: number
  let totalLaunched = 0

  if (split.type === 'fixed') {
    // Quota fixa definida na criação do split
    amountForJoiner = parseFloat(
      (Number(split.target_amount) / (split.max_participants ?? acceptedCount + 1)).toFixed(2),
    )
  } else {
    // Variable: buscar lançamentos existentes
    const { data: items } = await supabaseAdmin
      .from('split_items')
      .select('value')
      .eq('split_id', split.id)

    totalLaunched = parseFloat(
      (items?.reduce((s, i) => s + Number(i.value), 0) ?? 0).toFixed(2),
    )

    if (totalLaunched > 0 || !split.max_participants) {
      // Com lançamentos: recalcular pelo saldo restante (§11.3)
      // Sem max_participants: dinâmico pelo número atual de participantes
      const remaining = parseFloat((Number(split.target_amount) - totalLaunched).toFixed(2))
      amountForJoiner = parseFloat((remaining / (acceptedCount + 1)).toFixed(2))
    } else {
      // Sem lançamentos e com max definido: quota fixa = teto / max
      amountForJoiner = parseFloat(
        (Number(split.target_amount) / split.max_participants).toFixed(2),
      )
    }
  }

  // ── Verificar saldo do participante ──────────────────────────────────────────

  if (!joiner.asaas_api_key_enc)
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta financeira não configurada', 503)

  let joinerApiKey: string
  try {
    joinerApiKey = await aesDecrypt(joiner.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
  } catch (e) {
    await logError(supabaseAdmin, 'split-join', e, { joiner_id: joiner.id })
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  let joinerBalance: number
  try {
    joinerBalance = await getSubcontaBalance(joinerApiKey)
  } catch (e) {
    await logError(supabaseAdmin, 'split-join', e, { joiner_id: joiner.id })
    return err('ASAAS_ERROR', 'Não foi possível verificar saldo', 503)
  }

  if (joinerBalance < amountForJoiner) {
    return err(
      'INSUFFICIENT_BALANCE',
      `Saldo insuficiente. Necessário: ${amountForJoiner.toFixed(2)} Albers`,
      422,
    )
  }

  // ── Registrar participante ────────────────────────────────────────────────────

  const now = new Date().toISOString()

  const { error: insertErr } = await supabaseAdmin
    .from('split_participants')
    .insert({
      split_id:       split.id,
      user_id:        joiner.id,
      status:         'accepted',
      blocked_amount: split.type === 'variable' ? amountForJoiner : 0,
      joined_at:      now,
    })

  if (insertErr) {
    await logError(supabaseAdmin, 'split-join', insertErr, { split_id: split.id, joiner_id: joiner.id })
    return err('DB_ERROR', 'Erro ao registrar participante', 500)
  }

  // ── Fixed: Asaas transfer imediato participante → dono ────────────────────────

  if (split.type === 'fixed') {
    const { data: ownerUser } = await supabaseAdmin
      .from('users')
      .select('asaas_wallet_id')
      .eq('id', split.owner_id)
      .maybeSingle()

    if (!ownerUser?.asaas_wallet_id) {
      await supabaseAdmin.from('split_participants').delete()
        .eq('split_id', split.id).eq('user_id', joiner.id)
      return err('ACCOUNT_NOT_CONFIGURED', 'Conta do dono não configurada', 503)
    }

    const txRef = crypto.randomUUID()
    const { data: txRow } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id:        joiner.id,
        type:           'split_debit',
        amount:         amountForJoiner,
        amount_brl:     amountForJoiner,
        fee_amount:     0,
        status:         'pending',
        reference_id:   split.id,
        reference_type: 'split',
        metadata:       { split_id: split.id, split_name: split.name, owner_id: split.owner_id },
      })
      .select('id')
      .single()

    const txId = txRow?.id ?? txRef

    try {
      await transferToWallet(
        amountForJoiner,
        ownerUser.asaas_wallet_id,
        `Split: ${split.name}`,
        txId,
        joinerApiKey,
      )
      await supabaseAdmin.from('transactions').update({ status: 'completed' }).eq('id', txId)
    } catch (e) {
      await logError(supabaseAdmin, 'split-join', e, { split_id: split.id, joiner_id: joiner.id })
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', txId)
      await supabaseAdmin.from('split_participants').delete()
        .eq('split_id', split.id).eq('user_id', joiner.id)
      return err('ASAAS_ERROR', 'Falha ao processar pagamento. Tente novamente.', 503)
    }

    // Auto-close quando todos aderiram
    const newTotal = acceptedCount + 1
    if (split.max_participants && newTotal >= split.max_participants) {
      await supabaseAdmin
        .from('splits')
        .update({ status: 'closed', closed_at: now })
        .eq('id', split.id)
        .catch(e => console.error('[split-join] auto-close failed:', e))
    }
  }

  // ── Variable: Asaas transfer imediato joiner → dono + recálculo §11.3 real ──

  if (split.type === 'variable') {
    // Buscar wallet e API key do dono (receber pagamento + fazer devoluções §11.3)
    const { data: ownerUser } = await supabaseAdmin
      .from('users')
      .select('asaas_wallet_id, asaas_api_key_enc')
      .eq('id', split.owner_id)
      .maybeSingle()

    if (!ownerUser?.asaas_wallet_id) {
      await supabaseAdmin.from('split_participants').delete()
        .eq('split_id', split.id).eq('user_id', joiner.id)
      return err('ACCOUNT_NOT_CONFIGURED', 'Conta do dono não configurada', 503)
    }

    // TX pending antes do Asaas (idempotência)
    const { data: txRow } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id:        joiner.id,
        type:           'split_block',
        amount:         amountForJoiner,
        amount_brl:     amountForJoiner,
        fee_amount:     0,
        status:         'pending',
        reference_id:   split.id,
        reference_type: 'split',
        metadata:       { split_id: split.id, split_name: split.name },
      })
      .select('id')
      .single()
    const txId = txRow?.id ?? crypto.randomUUID()

    // Asaas: joiner → dono (dinheiro real ao entrar — SP-02)
    try {
      await transferToWallet(
        amountForJoiner,
        ownerUser.asaas_wallet_id,
        `Split: ${split.name}`,
        txId,
        joinerApiKey,
      )
      await supabaseAdmin.from('transactions').update({ status: 'completed' }).eq('id', txId)
    } catch (e) {
      console.error('Asaas variable split join failed:', e)
      const asaasResponse = e instanceof AsaasError ? e.asaasResponse : null
      await logError(supabaseAdmin, 'split-join', e,
        { split_id: split.id, joiner_id: joiner.id },
        { asaas_response: asaasResponse },
      )
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', txId)
      await supabaseAdmin.from('split_participants').delete()
        .eq('split_id', split.id).eq('user_id', joiner.id)
      return err('ASAAS_ERROR', 'Falha ao processar pagamento. Tente novamente.', 503)
    }

    // Recálculo §11.3 com dinheiro real: quando há lançamentos anteriores
    if (totalLaunched > 0 && currentParticipants && currentParticipants.length > 0) {
      // amountForJoiner = (target - launched) / (N+1) — nova obrigação restante por pessoa
      const newRemainingPerPerson = amountForJoiner

      // Descriptografar API key do dono para emitir devoluções
      let ownerApiKey: string | null = null
      if (ownerUser.asaas_api_key_enc) {
        try {
          ownerApiKey = await aesDecrypt(ownerUser.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
        } catch (e) {
          await logError(supabaseAdmin, 'split-join', e,
            { split_id: split.id, reason: 'owner_key_decrypt_recalc' },
          )
        }
      }

      // Buscar todos split_debit TXs do split em uma query (consumed por participante)
      const { data: allDebitTxs } = await supabaseAdmin
        .from('transactions')
        .select('user_id, amount')
        .eq('type', 'split_debit')
        .eq('reference_id', split.id)
        .eq('status', 'completed')

      const consumedByUser = new Map<string, number>()
      for (const tx of allDebitTxs ?? []) {
        consumedByUser.set(
          tx.user_id,
          parseFloat(((consumedByUser.get(tx.user_id) ?? 0) + Number(tx.amount)).toFixed(2)),
        )
      }

      const recalcUpdates = (currentParticipants as ParticipantRow[]).map(async (p) => {
        const consumed      = consumedByUser.get(p.user_id) ?? 0
        const oldPaid       = parseFloat(Number(p.blocked_amount).toFixed(2))
        const newObligation = parseFloat((consumed + newRemainingPerPerson).toFixed(2))
        const refund        = parseFloat((oldPaid - newObligation).toFixed(2))

        // Atualizar blocked_amount para nova obrigação total (consumido + restante)
        await supabaseAdmin
          .from('split_participants')
          .update({ blocked_amount: newObligation })
          .eq('id', p.id)
          .catch(e => console.error(`[split-join] recalc blocked update failed user=${p.user_id}:`, e))

        if (refund < 0.01 || !ownerApiKey) return  // sem devolução significativa

        // Buscar wallet do participante para receber a devolução
        const { data: participantUser } = await supabaseAdmin
          .from('users')
          .select('asaas_wallet_id')
          .eq('id', p.user_id)
          .maybeSingle()

        if (!participantUser?.asaas_wallet_id) {
          console.error(`[split-join] recalc: sem wallet para participante ${p.user_id}`)
          return
        }

        // TX de devolução pending
        const { data: refundTxRow } = await supabaseAdmin
          .from('transactions')
          .insert({
            user_id:        p.user_id,
            type:           'split_refund',
            amount:         refund,
            amount_brl:     refund,
            fee_amount:     0,
            status:         'pending',
            reference_id:   split.id,
            reference_type: 'split',
            metadata:       { split_id: split.id, reason: 'participant_recalc', new_remaining: newRemainingPerPerson },
          })
          .select('id')
          .single()
        const refundTxId = refundTxRow?.id ?? crypto.randomUUID()

        // Asaas: dono → participante (best-effort — não bloqueia se falhar)
        try {
          await transferToWallet(
            refund,
            participantUser.asaas_wallet_id,
            `Devolução Split: ${split.name}`,
            refundTxId,
            ownerApiKey,
          )
          await supabaseAdmin.from('transactions').update({ status: 'completed' }).eq('id', refundTxId)
        } catch (e) {
          const asaasResponse = e instanceof AsaasError ? e.asaasResponse : null
          await logError(supabaseAdmin, 'split-join', e,
            { split_id: split.id, participant_id: p.user_id, refund },
            { asaas_response: asaasResponse },
          )
          await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', refundTxId)
        }
      })

      await Promise.allSettled(recalcUpdates)

      // Push §11.3 para participantes recalculados (SP-19)
      const recalcPushes = (currentParticipants as ParticipantRow[]).map(p =>
        sendPush(
          p.user_id,
          'Novo participante no split',
          'Um novo participante entrou. Seu valor foi recalculado.',
        ),
      )
      await Promise.allSettled(recalcPushes)
    }
  }

  // ── Push para o dono ─────────────────────────────────────────────────────────

  await sendPush(
    split.owner_id,
    'Novo participante',
    `${joiner.handle} entrou no split "${split.name}"`,
  )

  // ── Audit log ─────────────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    joiner.id,
    event_type: 'split_joined',
    metadata:   { split_id: split.id, type: split.type, amount: amountForJoiner },
  }).catch(() => {})

  // ── Retornar detalhe atualizado do split ─────────────────────────────────────

  const { data: updatedParticipants } = await supabaseAdmin
    .from('split_participants')
    .select('user_id, status, blocked_amount, joined_at')
    .eq('split_id', split.id)
    .eq('status', 'accepted')

  return json({
    split_id:          split.id,
    name:              split.name,
    type:              split.type,
    target_amount:     split.target_amount,
    status:            split.status,
    your_amount:       amountForJoiner,
    participants:      updatedParticipants ?? [],
    invite_expires_at: split.invite_expires_at,
  })
})
