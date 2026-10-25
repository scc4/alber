// Cadastro: disponibilidade do @handle enquanto a pessoa digita (Alber Food e, se quiser, o app).
// POST /auth-check-handle { handle }  ->  { available: boolean }
//
// Sem login: o cadastro ainda não tem conta. A regra é a mesma do auth-register e do company-create: o @ não pode
// existir entre usuários nem entre empresas ativas (a busca por @ em financial-transferir ficaria ambígua).
// Só devolve o booleano. O @ já é público no Alber (user-search), mas o endpoint tem limite por IP para não virar
// ferramenta de varredura.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { isValidHandleFormat } from '../_shared/company.ts'
import { isReservedByOther } from '../_shared/handle-reservation.ts'

interface CheckHandleRequest {
  handle: string
}

/** Digitar dispara uma checagem por pausa; 60 a cada 15 minutos por IP cobre um cadastro com folga. */
const MAX_CHECKS = 60

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: CheckHandleRequest
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const handle = (typeof body.handle === 'string' ? body.handle : '').toLowerCase().replace(/^@/, '')
  // O login só reconhece @ que começa por letra (ver auth-login), então o cadastro também exige.
  if (!isValidHandleFormat(handle) || !/^[a-z]/.test(handle)) return err('HANDLE_INVALID', '@handle inválido', 422)

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'check_handle_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)

  if ((attempts ?? 0) >= MAX_CHECKS) {
    return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  }
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    null,
    event_type: 'check_handle_attempt',
    ip_address: clientIp,
  })

  // O @ de usuário já foi gravado com e sem "@" (perfil-update-handle grava com): olha as duas formas.
  const [{ data: handleUser }, { data: handleCompany }, reserved] = await Promise.all([
    supabaseAdmin.from('users').select('id').in('handle', [handle, '@' + handle]).limit(1).maybeSingle(),
    supabaseAdmin.from('companies').select('id').eq('handle', handle).is('deleted_at', null).maybeSingle(),
    isReservedByOther(supabaseAdmin, handle), // reservado pelo Alber Food para outra conta
  ])

  return json({ available: !handleUser && !handleCompany && !reserved })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
