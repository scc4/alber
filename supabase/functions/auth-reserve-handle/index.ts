// Reserva de @handle para o Alber Food (migration 050).
// POST /auth-reserve-handle { action: 'reserve', handle, owner_ref }  -> { reserved: true }
// POST /auth-reserve-handle { action: 'release', owner_ref }          -> { released: true }
//
// Só o Alber Food chama: exige o cabeçalho x-alber-food-key igual ao segredo ALBER_FOOD_SERVICE_KEY (comparação em tempo
// constante). Sem o segredo configurado a função recusa tudo (503): nunca fica aberta por esquecimento.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { isValidHandleFormat } from '../_shared/company.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const secret = Deno.env.get('ALBER_FOOD_SERVICE_KEY')
  if (!secret || secret.length < 32) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  if (!safeEqual(req.headers.get('x-alber-food-key') ?? '', secret)) return err('UNAUTHORIZED', 'Não autorizado', 401)

  let body: { action?: string; handle?: string; owner_ref?: string }
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const ownerRef = typeof body.owner_ref === 'string' ? body.owner_ref : ''
  if (!UUID.test(ownerRef)) return err('INVALID_OWNER', 'owner_ref inválido', 422)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  if (body.action === 'release') {
    const { error } = await supabaseAdmin.from('handle_reservations').delete().eq('owner_ref', ownerRef)
    if (error) return err('DB_ERROR', 'Erro ao liberar', 503)
    return json({ released: true })
  }
  if (body.action !== 'reserve') return err('INVALID_ACTION', 'action inválida', 422)

  const handle = (typeof body.handle === 'string' ? body.handle : '').toLowerCase().replace(/^@/, '')
  // O login só reconhece @ que começa por letra (ver auth-login).
  if (!isValidHandleFormat(handle) || !/^[a-z]/.test(handle)) return err('HANDLE_INVALID', '@handle inválido', 422)

  // Já é de um usuário (nas duas formas gravadas: com e sem @) ou de uma empresa ativa?
  const [{ data: handleUser }, { data: handleCompany }] = await Promise.all([
    supabaseAdmin.from('users').select('id').in('handle', [handle, '@' + handle]).limit(1).maybeSingle(),
    supabaseAdmin.from('companies').select('id').eq('handle', handle).is('deleted_at', null).maybeSingle(),
  ])
  if (handleUser || handleCompany) return err('HANDLE_TAKEN', '@handle já em uso', 409)

  // Um @ por dono: reservar outro solta o anterior. Depois, tenta pegar o novo; se alguém chegou antes, a chave primária recusa.
  await supabaseAdmin.from('handle_reservations').delete().eq('owner_ref', ownerRef).neq('handle', handle)
  await supabaseAdmin.from('handle_reservations').insert({ handle, owner_ref: ownerRef })
  const { data: mine } = await supabaseAdmin.from('handle_reservations').select('owner_ref').eq('handle', handle).maybeSingle()
  if (!mine || (mine as { owner_ref: string }).owner_ref !== ownerRef) return err('HANDLE_TAKEN', '@handle já reservado', 409)
  return json({ reserved: true })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
