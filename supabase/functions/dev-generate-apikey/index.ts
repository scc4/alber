// Uso exclusivo em sandbox — gera e salva uma nova apiKey de subconta Asaas.
// Spec: /specs/04_api_asaas.md §4.1  |  /specs/05_security.md §7

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesEncrypt } from '../_shared/crypto.ts'

const ASAAS_SANDBOX_URL = 'https://api-sandbox.asaas.com/v3'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // Garantia: só roda em sandbox
  if (Deno.env.get('ASAAS_ENVIRONMENT') !== 'sandbox') {
    return err('FORBIDDEN', 'Endpoint disponível apenas em ambiente sandbox', 403)
  }

  let body: { user_id?: string }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { user_id } = body
  if (!user_id) return err('MISSING_FIELDS', 'user_id é obrigatório', 400)

  // Buscar asaas_account_id do usuário
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, asaas_account_id')
    .eq('id', user_id)
    .maybeSingle()

  if (userError) {
    console.error('[dev-generate-apikey] db lookup failed:', userError)
    return err('DB_ERROR', 'Erro ao buscar usuário', 500)
  }
  if (!user?.asaas_account_id) {
    return err('USER_NOT_FOUND', 'Usuário não encontrado ou sem subconta Asaas', 404)
  }

  const encSecret  = Deno.env.get('ASAAS_API_KEY')!
  const accountId  = user.asaas_account_id

  // Gerar novo accessToken na subconta via conta pai
  const asaasRes = await fetch(
    `${ASAAS_SANDBOX_URL}/accounts/${accountId}/accessTokens`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'access_token':  encSecret,
      },
      body: JSON.stringify({ name: 'Alber App' }),
    },
  )

  if (!asaasRes.ok) {
    const body = await asaasRes.json().catch(() => ({}))
    console.error('[dev-generate-apikey] asaas error:', body)
    return err('ASAAS_ERROR', 'Erro ao gerar apiKey na subconta', asaasRes.status)
  }

  const asaasData = await asaasRes.json() as { accessToken?: string }
  const accessToken = asaasData.accessToken

  if (!accessToken) {
    console.error('[dev-generate-apikey] accessToken ausente na resposta:', asaasData)
    return err('ASAAS_ERROR', 'accessToken não retornado pelo Asaas', 502)
  }

  // Criptografar e salvar
  const encrypted = await aesEncrypt(accessToken, encSecret)

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ asaas_api_key_enc: encrypted })
    .eq('id', user_id)

  if (updateError) {
    console.error('[dev-generate-apikey] update failed:', updateError)
    return err('DB_ERROR', 'apiKey gerada mas não salva — tente novamente', 500)
  }

  console.log(`[dev-generate-apikey] apiKey gerada e salva para user_id=${user_id}`)
  return json({ success: true, hint: 'apiKey gerada e salva' })
})
