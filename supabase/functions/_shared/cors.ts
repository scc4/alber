// CORS só vale para navegadores. O app (React Native) e o Alber Food/Admin (servidor para servidor) não usam CORS, então por padrão
// NENHUMA origem é liberada (antes: '*', auditoria de 09/11/2026). Para um cliente web (ex.: `expo start --web` em desenvolvimento ou um
// site futuro), defina o segredo ALBER_CORS_ORIGIN com UMA origem exata, por exemplo https://app.usealber.com.br.
const allowedOrigin = (Deno.env.get('ALBER_CORS_ORIGIN') ?? '').trim()

export const corsHeaders: Record<string, string> = {
  ...(allowedOrigin && allowedOrigin !== '*' ? { 'Access-Control-Allow-Origin': allowedOrigin, 'Vary': 'Origin' } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function err(code: string, message: string, status: number, extra?: Record<string, unknown>): Response {
  return json({ error: code, code, message, ...extra }, status)
}
