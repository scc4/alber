// POST /company-owner-verify { company_id, cnpj, cpf }
// O master confere o vínculo dele com a empresa DEPOIS da criação: empresas anteriores à regra (fila "legacy"), empresas abertas sem
// CPF (app) e empresas que o Alber Food liga. Faz o mesmo que a abertura: o CPF digitado tem de ser o da conta (hash) e é comparado
// com o quadro societário do CNPJ (_shared/owner-link.ts). `match` tira a empresa da fila; qualquer outro resultado a deixa
// (ou a coloca) em revisão da equipe. O CNPJ também é digitado: o Alber só guarda o hash dele.
//
// Autorização: só o master (owner_id). Empresa já aprovada/conferida só devolve a situação; revisão RECUSADA pela equipe não se refaz aqui.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { sha256hex } from '../_shared/crypto.ts'
import { evaluateOwnerCpf, fetchCnpjRegistry, reviewFor, verifyOwnerCpfHash, type CnpjRegistry } from '../_shared/owner-link.ts'

interface VerifyRequest {
  company_id: string
  cnpj: string
  cpf: string
}

export interface VerifyDeps {
  registry?: (cnpj: string) => Promise<CnpjRegistry | null>
}

export async function handleRequest(req: Request, deps: VerifyDeps = {}): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: VerifyRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  if (!body.company_id) return err('MISSING_FIELDS', 'company_id é obrigatório', 400)

  const cnpjClean = normalizeCnpj(body.cnpj ?? '')
  if (!validateCnpj(cnpjClean)) return err('CNPJ_INVALID', 'CNPJ inválido', 422)

  const { data: caller } = await supabaseAdmin.from('users').select('id, cpf, deleted_at, account_status').eq('auth_id', authUser.id).maybeSingle()
  if (!caller || caller.deleted_at) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, cnpj, deleted_at, owner_link_check, owner_link_review')
    .eq('id', body.company_id)
    .maybeSingle()
  if (!company || company.deleted_at) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)
  // Só o master: um operador não pode atestar o vínculo (nem de si mesmo) com a empresa.
  if (company.owner_id !== caller.id) return err('FORBIDDEN', 'Só o master pode conferir o vínculo da empresa', 403)

  // ── Limite: 10 tentativas por IP em 15 minutos (cada uma consulta um serviço externo) ───────────────────────────────────────
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs').select('id', { count: 'exact', head: true })
    .eq('event_type', 'owner_verify_attempt').eq('ip_address', clientIp).gte('created_at', since)
  if ((attempts ?? 0) >= 10) return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  await supabaseAdmin.from('audit_logs').insert({ user_id: caller.id, event_type: 'owner_verify_attempt', ip_address: clientIp })

  // O CNPJ digitado é o da empresa?
  if ((await sha256hex(cnpjClean)) !== company.cnpj) return err('CNPJ_MISMATCH', 'CNPJ não confere com o cadastrado', 422)

  // Já conferida ou aprovada pela equipe: devolve como está. Recusada pela equipe: só o suporte reabre.
  if (company.owner_link_review === 'not_needed' || company.owner_link_review === 'approved') {
    return json({ owner_link_check: company.owner_link_check, owner_link_review: company.owner_link_review, changed: false })
  }
  if (company.owner_link_review === 'rejected') return err('OWNER_LINK_REJECTED', 'A conferência desta empresa foi recusada. Fale com o suporte.', 409)

  const proof = await verifyOwnerCpfHash(body.cpf, caller.cpf)
  if (!proof.ok) {
    return proof.code === 'CPF_INVALID' ? err('CPF_INVALID', 'CPF inválido', 422) : err('OWNER_CPF_MISMATCH', 'O CPF informado não é o da sua conta Alber', 422)
  }

  const verdict = evaluateOwnerCpf(proof.cpf, await (deps.registry ?? fetchCnpjRegistry)(cnpjClean))
  const review = reviewFor(verdict.check)
  const now = new Date().toISOString()
  const { error: updErr } = await supabaseAdmin
    .from('companies')
    .update({ owner_link_check: verdict.check, owner_link_review: review, owner_link_qualification: verdict.qualification, owner_link_checked_at: now, updated_at: now })
    .eq('id', company.id)
  if (updErr) return err('DB_ERROR', 'Erro ao salvar a conferência', 500)

  await supabaseAdmin.from('audit_logs').insert({
    user_id: caller.id,
    event_type: 'company_owner_verified',
    metadata: { company_id: company.id, check: verdict.check, review, previous_review: company.owner_link_review },
  })
  return json({ owner_link_check: verdict.check, owner_link_review: review, changed: true })
}

if (import.meta.main) {
  Deno.serve((req) => handleRequest(req))
}
