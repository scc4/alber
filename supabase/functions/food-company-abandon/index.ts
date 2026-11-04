// POST /food-company-abandon   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário; verify_jwt padrão, como as takeaway-*)
//   { company_id, owner_ref } -> 200 { company_id, abandoned: true }
//
// O dono desiste do cadastro da empresa ANTES da aprovação do KYC (ex.: digitou o CNPJ errado): libera o CNPJ e o @ na hora (deleted_at).
// Não move dinheiro, então não leva autorização assinada. Mesma regra de company-abandon (app), em _shared/company-abandon.ts:
//   - empresa que não existe, ou que não é deste dono: 404 COMPANY_NOT_FOUND (não revela que a empresa existe para outro dono);
//   - já cancelada: 409 ALREADY_ABANDONED; com KYC aprovado: 422 COMPANY_ALREADY_APPROVED.
// Não mexe na subconta do Asaas (fica órfã: abrir de novo o mesmo CNPJ dá CNPJ_IN_USE e vira caso do suporte, como na rejeição de KYC).
// Diferença deliberada em relação ao app: a gravação é condicional a "ainda não cancelada e ainda não aprovada", para o cancelamento
// nunca apagar uma empresa que o Asaas aprovou entre a leitura e a gravação.

import { handleCors, json, err } from '../_shared/cors.ts'
import { abandonPatch, abandonRefusal } from '../_shared/company-abandon.ts'
import { logError } from '../_shared/error-log.ts'
import { adminClient, readIds, readServiceBody } from '../_shared/food-company.ts'

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const ids = readIds(parsed.body)
  if (!ids.ok) return ids.res

  const supabaseAdmin = adminClient()
  // Não usa loadOwnedCompany: a empresa já cancelada tem de ser lida (ALREADY_ABANDONED) e o dono errado é 404, não 403.
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id, owner_ref, kyc_status, deleted_at')
    .eq('id', ids.companyId)
    .maybeSingle()
  if (error) return err('DB_ERROR', 'Erro ao consultar a empresa', 503)
  const company = data as { id: string; owner_ref: string | null; kyc_status: string; deleted_at: string | null } | null
  if (!company || !company.owner_ref || company.owner_ref !== ids.ownerRef) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)

  const refusal = abandonRefusal(company)
  if (refusal) return err(refusal.code, refusal.message, refusal.status)

  const { data: saved, error: updateErr } = await supabaseAdmin
    .from('companies')
    .update(abandonPatch())
    .eq('id', company.id)
    .is('deleted_at', null)
    .neq('kyc_status', 'approved')
    .select('id')
  if (updateErr) {
    await logError(supabaseAdmin, 'food-company-abandon', updateErr, { company_id: company.id })
    return err('DB_ERROR', 'Erro ao cancelar cadastro da empresa', 500)
  }
  if (!saved || saved.length === 0) {
    // Perdeu a corrida: foi cancelada ou aprovada entre a leitura e a gravação. Relê para responder com o estado certo.
    const { data: now } = await supabaseAdmin.from('companies').select('kyc_status, deleted_at').eq('id', company.id).maybeSingle()
    const again = now ? abandonRefusal(now as { kyc_status: string; deleted_at: string | null }) : null
    return again ? err(again.code, again.message, again.status) : err('DB_ERROR', 'Erro ao cancelar cadastro da empresa', 500)
  }

  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: null,
      event_type: 'company_abandoned',
      metadata: { company_id: company.id, previous_kyc_status: company.kyc_status, via: 'food', owner_ref: ids.ownerRef },
    })
  } catch { /* não crítico */ }

  return json({ company_id: company.id, abandoned: true })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
