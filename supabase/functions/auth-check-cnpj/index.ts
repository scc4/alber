// Item 46 do QA de cadastro PJ — mesma lógica de auth-check-cpf (item 36 na PF)
// POST /auth-check-cnpj { cnpj }
// Descobre se o CNPJ digitado na etapa "Dados da empresa" já tem uma conta
// ativa, para avisar em tempo real em vez de deixar a pessoa percorrer o
// cadastro inteiro só pra ser barrada no fim (CNPJ_DUPLICATE, tratado em
// terms.tsx/empresa-pix.tsx como rede de segurança contra corrida).
//
// Não retorna nada além do booleano — mesmo raciocínio de auth-check-cpf.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { sha256hex } from '../_shared/crypto.ts'

interface CheckCnpjRequest {
  cnpj: string
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: CheckCnpjRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const cnpjClean = normalizeCnpj(body.cnpj ?? '')
  if (!validateCnpj(cnpjClean)) return err('CNPJ_INVALID', 'CNPJ inválido', 422)

  // ── Rate limit: máx 10 checagens por IP a cada 15 minutos ────────────────────
  // Mesmo padrão de auth-check-cpf — sem isso o endpoint vira um oráculo pra
  // enumerar CNPJs válidos já cadastrados.

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'check_cnpj_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)

  if ((attempts ?? 0) >= 10) {
    return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  }
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    null,
    event_type: 'check_cnpj_attempt',
    ip_address: clientIp,
  })

  const cnpjHash = await sha256hex(cnpjClean)
  // Empresas com deleted_at (rejeitada pelo Asaas ou abandonada pelo master —
  // migration 044) já liberaram o CNPJ, mesmo raciocínio do índice parcial
  // usado por createCompanyForOwner.
  const { data: existing } = await supabaseAdmin
    .from('companies')
    .select('id')
    .eq('cnpj', cnpjHash)
    .is('deleted_at', null)
    .maybeSingle()

  return json({ exists: !!existing })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
