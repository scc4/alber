// UTILITÁRIO TEMPORÁRIO — apenas sandbox
// Remove antes de ir para produção

import { aesDecrypt } from '../_shared/crypto.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const env = Deno.env.get('ASAAS_ENVIRONMENT') ?? ''
  if (env !== 'sandbox') {
    return json({ error: 'Disponível apenas em sandbox' }, 403)
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { encrypted?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const { encrypted } = body
  if (!encrypted || typeof encrypted !== 'string') {
    return json({ error: 'Campo "encrypted" obrigatório' }, 400)
  }

  const secret = Deno.env.get('ASAAS_API_KEY')
  if (!secret) return json({ error: 'ASAAS_API_KEY não configurada' }, 500)

  try {
    const decrypted = await aesDecrypt(encrypted, secret)
    return json({ decrypted })
  } catch {
    return json({ error: 'Falha ao descriptografar — verifique o valor encrypted' }, 422)
  }
})
