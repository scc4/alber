import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

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

  const purpose = body.purpose ?? 'pin_change'
  if (!['pin_change', 'pix_change'].includes(purpose)) {
    return err('INVALID_PURPOSE', 'purpose inválido', 400)
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // Rate limit: máx 3 códigos em 10 minutos
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

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

  await supabaseAdmin.from('sms_codes').insert({
    user_id:    user.id,
    code,
    purpose,
    expires_at: expiresAt,
  })

  // Production: Twilio send. During development, log for testing.
  const twilioSid    = Deno.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken  = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioFrom   = Deno.env.get('TWILIO_FROM_NUMBER')

  const phone = authUser.phone
  if (twilioSid && twilioToken && twilioFrom && phone) {
    try {
      const twilioBody = new URLSearchParams({
        To:   phone,
        From: twilioFrom,
        Body: `Alber: seu código de verificação é ${code}. Válido por 10 minutos.`,
      })
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: twilioBody.toString(),
        },
      )
    } catch (e) {
      console.error('[perfil-send-sms] Twilio error:', e)
    }
  } else {
    console.log(`[perfil-send-sms] DEV — código para user ${user.id}: ${code}`)
  }

  return json({ success: true })
})
