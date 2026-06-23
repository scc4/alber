// Spec: /specs/06_modules/split.md §5
// Fecha split variável: valida PIN, registra alocações finais, atualiza status.
//
// Regras:
//   - Somente o dono pode fechar
//   - Split deve estar aberto (status = 'open') e ser variável
//   - PIN verificado via bcrypt (padrão dos flows financeiros)
//   - final_amount registrado em split_participants por participante
//   - excedente (blocked_amount − final_amount) devolvido ao participante via Asaas

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { bcryptVerify, aesDecrypt } from '../_shared/crypto.ts'
import { transferToWallet, AsaasError } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { sendPush } from '../_shared/push.ts'

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
    .select('id, auth_id, asaas_api_key_enc')
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

  // ── Descriptografar API key do dono para emitir devoluções ──────────────────

  if (!user.asaas_api_key_enc) {
    return err('ACCOUNT_NOT_CONFIGURED', 'Conta do dono não configurada para devoluções', 503)
  }

  let ownerApiKey: string
  try {
    ownerApiKey = await aesDecrypt(user.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
  } catch (e) {
    await logError(supabaseAdmin, 'split-close', e, { split_id })
    return err('CRYPTO_ERROR', 'Erro interno de segurança', 500)
  }

  // ── Buscar blocked_amount por participante (quanto cada um já pagou ao dono) ──

  const { data: participantBlocks } = await supabaseAdmin
    .from('split_participants')
    .select('user_id, blocked_amount')
    .eq('split_id', split_id)
    .eq('status', 'accepted')

  const blockedByUser = new Map<string, number>()
  for (const p of participantBlocks ?? []) {
    blockedByUser.set(p.user_id, Number(p.blocked_amount))
  }

  // ── Registrar final_amount + devolver excedente (dono → participante) ─────────

  const now = new Date().toISOString()
  const allocationEntries = Object.entries(allocations)

  const updatePromises = allocationEntries.map(async ([userId, finalAmount]) => {
    if (typeof finalAmount !== 'number' || finalAmount < 0) return

    // Atualizar final_amount e status do participante
    await supabaseAdmin
      .from('split_participants')
      .update({ final_amount: finalAmount, status: 'settled' })
      .eq('split_id', split_id)
      .eq('user_id', userId)
      .catch(e => console.error(`[split-close] final_amount update failed user=${userId}:`, e))

    // TX de liquidação (contabilidade do valor final cobrado)
    await supabaseAdmin.from('transactions').insert({
      user_id:        userId,
      type:           'split_settle',
      amount:         finalAmount,
      amount_brl:     finalAmount,
      fee_amount:     0,
      status:         'completed',
      reference_id:   split_id,
      reference_type: 'split',
      metadata:       { split_id, split_name: split.name, final_amount: finalAmount },
    }).catch(e => console.error(`[split-close] split_settle tx failed user=${userId}:`, e))

    // Calcular excedente: o que o participante pagou além do valor final definido
    const blocked   = blockedByUser.get(userId) ?? 0
    const excedente = parseFloat((blocked - finalAmount).toFixed(2))

    if (excedente < 0.01) return  // sem excedente para devolver

    // Buscar wallet do participante para receber a devolução
    const { data: participantUser } = await supabaseAdmin
      .from('users')
      .select('asaas_wallet_id')
      .eq('id', userId)
      .maybeSingle()

    if (!participantUser?.asaas_wallet_id) {
      console.error(`[split-close] sem wallet para participante ${userId}`)
      return
    }

    // TX de devolução pending antes do Asaas
    const { data: refundTxRow } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id:        userId,
        type:           'split_refund',
        amount:         excedente,
        amount_brl:     excedente,
        fee_amount:     0,
        status:         'pending',
        reference_id:   split_id,
        reference_type: 'split',
        metadata:       { split_id, split_name: split.name, blocked, final_amount: finalAmount },
      })
      .select('id')
      .single()
    const refundTxId = refundTxRow?.id ?? crypto.randomUUID()

    // Asaas: dono → participante (devolução real do excedente)
    // best-effort: não bloqueia o fechamento por falha individual
    try {
      await transferToWallet(
        excedente,
        participantUser.asaas_wallet_id,
        `Devolução Split: ${split.name}`,
        refundTxId,
        ownerApiKey,
      )
      await supabaseAdmin.from('transactions').update({ status: 'completed' }).eq('id', refundTxId)
    } catch (e) {
      const asaasResponse = e instanceof AsaasError ? e.asaasResponse : null
      await logError(supabaseAdmin, 'split-close', e,
        { split_id, user_id: userId, excedente },
        { asaas_response: asaasResponse },
      )
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', refundTxId)
    }
  })

  await Promise.allSettled(updatePromises)

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

  // ── Push para todos os participantes (best-effort) ────────────────────────────

  const participantIds = Object.keys(allocations).filter(id => id !== user.id)
  await Promise.allSettled(
    participantIds.map(pid =>
      sendPush(pid, 'Split encerrado', `O split "${split.name}" foi fechado.`, { route: `/(app)/split/${split_id}` })
    )
  )

  return json({ split_id, status: 'closed', closed_at: now })
})
