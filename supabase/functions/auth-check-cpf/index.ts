// Melhoria 1 (cadastro de empresa para quem já tem conta pessoal)
// POST /auth-check-cpf { cpf }
// Primeiro passo do cadastro de empresa: descobre se o CPF do responsável já
// tem conta ativa — se tiver, o app pede PIN + pergunta de segurança (login
// normal) e cria a empresa direto na conta existente, em vez de forçar um
// cadastro pessoal novo (que sempre esbarrava em CPF_DUPLICATE/EMAIL_IN_USE).
//
// Não retorna NADA além do booleano — nome, e-mail, handle etc. só aparecem
// depois que a pessoa prova que é dona do CPF via auth-login.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../_shared/cpf.ts'
import { sha256hex } from '../_shared/crypto.ts'

interface CheckCpfRequest {
  cpf: string
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: CheckCpfRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const cpfClean = normalizeCpf(body.cpf ?? '')
  if (!validateCpf(cpfClean)) return err('CPF_INVALID', 'CPF inválido', 422)

  // ── Rate limit: máx 10 checagens por IP a cada 15 minutos ────────────────────
  // Sem isso, o endpoint vira um oráculo pra enumerar CPFs válidos cadastrados.

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'check_cpf_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)

  if ((attempts ?? 0) >= 10) {
    return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  }
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    null,
    event_type: 'check_cpf_attempt',
    ip_address: clientIp,
  })

  const cpfHash = await sha256hex(cpfClean)
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('cpf', cpfHash)
    .is('deleted_at', null)
    .maybeSingle()

  return json({ exists: !!existing })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
