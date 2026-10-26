// O e-mail já pertence a um usuário do Alber? (Alber Food: não se cria restaurante nem acesso com e-mail que já tem conta Alber.)
// POST /auth-check-email { email }  ->  { exists: boolean }
//
// Só o Alber Food chama: exige x-alber-food-key igual a ALBER_FOOD_SERVICE_KEY (comparação em tempo constante; sem o segredo
// configurado a função recusa tudo, 503). O Alber Food só consulta depois de provar a posse do e-mail por código, então quem
// não controla a caixa de entrada não descobre se o endereço existe. Mesmo assim há limite por IP.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

const MAX_CHECKS = 30
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

/** `ilike` trata % e _ como curingas: escapa para comparar o endereço literalmente, sem diferenciar maiúsculas. */
const literal = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const secret = Deno.env.get('ALBER_FOOD_SERVICE_KEY')
  if (!secret || secret.length < 32) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  if (!safeEqual(req.headers.get('x-alber-food-key') ?? '', secret)) return err('UNAUTHORIZED', 'Não autorizado', 401)

  let body: { email?: unknown }
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 254) return err('EMAIL_INVALID', 'E-mail inválido', 422)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'check_email_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)
  if ((attempts ?? 0) >= MAX_CHECKS) return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  await supabaseAdmin.from('audit_logs').insert({ user_id: null, event_type: 'check_email_attempt', ip_address: clientIp })

  const { data: user, error } = await supabaseAdmin.from('users').select('id').ilike('email', literal(email)).limit(1).maybeSingle()
  if (error) return err('DB_ERROR', 'Erro ao consultar', 503)
  return json({ exists: !!user })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
