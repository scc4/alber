// POST /perfil-confirm-cpf { cpf }
// Contas cadastradas antes da migration 048 não têm users.cpf_masked salvo
// (users.cpf só guarda o hash SHA-256 — nunca dá pra recuperar automaticamente).
// Esta função deixa o próprio usuário confirmar o CPF: se o hash bater com o
// que já está cadastrado, calcula e persiste a versão mascarada — nunca o
// CPF em texto puro.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf, maskCpfForDisplay } from '../_shared/cpf.ts'
import { sha256hex } from '../_shared/crypto.ts'

interface ConfirmCpfRequest {
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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  let body: ConfirmCpfRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const cpfClean = normalizeCpf(body.cpf ?? '')
  if (!validateCpf(cpfClean)) return err('CPF_INVALID', 'CPF inválido', 422)

  // ── Rate limit: máx 10 tentativas por IP a cada 15 minutos ──────────────────

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'confirm_cpf_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)

  if ((attempts ?? 0) >= 10) {
    return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  }
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    null,
    event_type: 'confirm_cpf_attempt',
    ip_address: clientIp,
  })

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, cpf')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (userErr || !user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const cpfHash = await sha256hex(cpfClean)
  if (cpfHash !== user.cpf) return err('CPF_MISMATCH', 'CPF não confere com o cadastrado', 422)

  const cpfMasked = maskCpfForDisplay(cpfClean)
  const { error: updateErr } = await supabaseAdmin
    .from('users')
    .update({ cpf_masked: cpfMasked })
    .eq('id', user.id)

  if (updateErr) return err('DB_ERROR', 'Erro ao salvar confirmação', 500)

  return json({ cpf_masked: cpfMasked })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
