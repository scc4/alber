// Plano velvet-puzzling-sedgewick (ciclo de vida do KYC de empresa)
// POST /company-abandon { company_id }
// O master desiste do próprio cadastro de empresa antes da aprovação do KYC
// (ex.: digitou o CNPJ errado) — libera o CNPJ/handle na hora (deleted_at,
// migration 044), sem precisar de suporte. Não mexe na subconta Asaas em si
// (fica órfã, mesmo trade-off aceito da rejeição automática via webhook).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

interface AbandonRequest {
  company_id: string
}

export async function handleRequest(req: Request): Promise<Response> {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

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

  let body: AbandonRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  if (!body.company_id) return err('MISSING_FIELDS', 'company_id é obrigatório', 400)

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()
  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, kyc_status, deleted_at')
    .eq('id', body.company_id)
    .maybeSingle()

  if (!company) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)
  if (company.owner_id !== caller.id) return err('FORBIDDEN', 'Só o master pode cancelar o cadastro da empresa', 403)
  if (company.deleted_at) return err('ALREADY_ABANDONED', 'Este cadastro já foi cancelado', 409)
  if (company.kyc_status === 'approved') {
    return err('COMPANY_ALREADY_APPROVED', 'Uma empresa já verificada não pode ser cancelada por aqui', 422)
  }

  const { error: updateErr } = await supabaseAdmin
    .from('companies')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', company.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'company-abandon', updateErr, { company_id: company.id })
    return err('DB_ERROR', 'Erro ao cancelar cadastro da empresa', 500)
  }

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    caller.id,
      event_type: 'company_abandoned',
      metadata:   { company_id: company.id, previous_kyc_status: company.kyc_status },
    })
  } catch { /* não-crítico */ }

  return json({ success: true })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
