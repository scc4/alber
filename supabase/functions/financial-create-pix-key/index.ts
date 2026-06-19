// Cria chave Pix EVP (aleatória) na subconta do usuário autenticado.
// Pré-condições: kyc_status = 'approved' e pix_key ausente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt, aesEncrypt } from '../_shared/crypto.ts'
import { createPixAddressKey } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // ── Auth ────────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Buscar usuário ───────────────────────────────────────────────────────────

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, kyc_status, pix_key, asaas_api_key_enc')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (userErr || !user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  if (user.kyc_status !== 'approved') {
    return err('KYC_NOT_APPROVED', 'Conta ainda não verificada', 403)
  }

  if (user.pix_key) {
    return err('PIX_KEY_EXISTS', 'Chave Pix já cadastrada', 409)
  }

  if (!user.asaas_api_key_enc) {
    return err('NO_SUBCONTA', 'Subconta financeira não configurada', 422)
  }

  // ── Criar chave EVP na subconta ──────────────────────────────────────────────

  try {
    const subApiKey = await aesDecrypt(user.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
    const { key }   = await createPixAddressKey('EVP', subApiKey)
    const encrypted = await aesEncrypt(key, Deno.env.get('ENCRYPTION_KEY')!)

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ pix_key: encrypted, pix_key_type: 'random' })
      .eq('id', user.id)

    if (updateErr) {
      await logError(supabaseAdmin, 'financial-create-pix-key', updateErr, { user_id: user.id })
      return err('DB_UPDATE_FAILED', 'Erro ao salvar chave Pix', 500)
    }

    const masked = `${key.slice(0, 8)}...`
    return json({ pix_key_masked: masked, pix_key_type: 'random' })
  } catch (e) {
    await logError(supabaseAdmin, 'financial-create-pix-key', e, { user_id: user.id })
    return err('PIX_KEY_CREATION_FAILED', 'Não foi possível criar a chave Pix', 500)
  }
})
