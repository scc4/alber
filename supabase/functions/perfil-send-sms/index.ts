import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const VALID_PURPOSES = ['pin_change', 'pix_change', 'forgot_pin'] as const
type Purpose = typeof VALID_PURPOSES[number]

// ── Normalizar número de telefone ─────────────────────────────────────────────
// Remove não-dígitos e garante prefixo 55 (Brasil)

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('55') ? digits : '55' + digits
}

// ── Enviar via Infobip ────────────────────────────────────────────────────────

async function sendViaInfobip(to: string, code: string): Promise<void> {
  const apiKey  = Deno.env.get('INFOBIP_API_KEY')
  const baseUrl = Deno.env.get('INFOBIP_BASE_URL')  // ex: xxxxx.api.infobip.com

  if (!apiKey || !baseUrl) {
    console.log(`[perfil-send-sms] DEV — código para ${to}: ${code}`)
    return
  }

  const body = {
    messages: [
      {
        destinations: [{ to }],
        from: 'Alber',
        text: `Seu código de verificação Alber: ${code}. Válido por 10 minutos.`,
      },
    ],
  }

  const res = await fetch(`https://${baseUrl}/sms/3/messages`, {
    method:  'POST',
    headers: {
      'Authorization': `App ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Infobip ${res.status}: ${text}`)
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
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

  let body: { purpose?: string }
  try { body = await req.json() } catch { body = {} }

  const purpose = (body.purpose ?? 'pin_change') as Purpose
  if (!VALID_PURPOSES.includes(purpose)) {
    return err('INVALID_PURPOSE', `purpose deve ser um de: ${VALID_PURPOSES.join(', ')}`, 400)
  }

  // ── Buscar usuário e telefone ─────────────────────────────────────────────

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const phone = authUser.phone
  if (!phone) return err('NO_PHONE', 'Nenhum telefone cadastrado na conta', 422)

  const normalizedPhone = normalizePhone(phone)

  // ── Rate limit: máx 3 códigos por número por 10 minutos ──────────────────

  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString()
  const { count } = await supabaseAdmin
    .from('sms_codes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('purpose', purpose)
    .gte('created_at', tenMinAgo)

  if ((count ?? 0) >= 3) {
    return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  }

  // ── Gerar e persistir código ──────────────────────────────────────────────

  const code      = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

  await supabaseAdmin.from('sms_codes').insert({
    user_id:    user.id,
    code,
    purpose,
    expires_at: expiresAt,
  })

  // ── Enviar ────────────────────────────────────────────────────────────────

  try {
    await sendViaInfobip(normalizedPhone, code)
  } catch (e) {
    console.error('[perfil-send-sms] Infobip error:', e)
    // Código já foi inserido — não bloquear o usuário por falha de envio.
    // O código ainda pode ser usado se o usuário já o tiver recebido.
  }

  return json({ success: true })
})
