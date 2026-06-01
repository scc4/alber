// Uso exclusivo em sandbox — salva manualmente uma apiKey de subconta Asaas.
// Spec: /specs/04_api_asaas.md §4.1  |  /specs/05_security.md §7

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesEncrypt } from '../_shared/crypto.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  if (Deno.env.get('ASAAS_ENVIRONMENT') !== 'sandbox') {
    return err('FORBIDDEN', 'Endpoint disponível apenas em ambiente sandbox', 403)
  }

  let body: { user_id?: string; asaas_api_key?: string }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { user_id, asaas_api_key } = body
  if (!user_id || !asaas_api_key) {
    return err('MISSING_FIELDS', 'user_id e asaas_api_key são obrigatórios', 400)
  }

  const encSecret = Deno.env.get('ASAAS_API_KEY')!
  const encrypted = await aesEncrypt(asaas_api_key, encSecret)

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ asaas_api_key_enc: encrypted })
    .eq('id', user_id)

  if (updateError) {
    console.error('[dev-save-apikey] update failed:', updateError)
    return err('DB_ERROR', 'Erro ao salvar apiKey', 500)
  }

  console.log(`[dev-save-apikey] apiKey salva para user_id=${user_id}`)
  return json({ success: true })
})
