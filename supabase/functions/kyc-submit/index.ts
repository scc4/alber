// Spec: /specs/06_modules/perfil.md §8, /specs/04_api_asaas.md §4.7
// POST /kyc-submit
// Body: { doc_type: 'rg'|'cnh', front_base64, back_base64, selfie_base64 }
// Faz upload dos documentos KYC para a Asaas e atualiza kyc_status → 'submitted'.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt } from '../_shared/crypto.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function asaasBase(): string {
  return Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
    ? 'https://api.asaas.com/api/v3'
    : 'https://sandbox.asaas.com/api/v3'
}

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

  // ── Buscar usuário ──────────────────────────────────────────────────────────

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, asaas_api_key_enc, kyc_status')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (userErr || !user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)
  if (!user.asaas_api_key_enc) return err('ASAAS_KEY_MISSING', 'Chave Asaas não configurada', 500)

  // Idempotência: já enviado ou aprovado
  if (user.kyc_status === 'submitted' || user.kyc_status === 'approved') {
    return json({ ok: true, already: true })
  }

  // ── Parsear body ────────────────────────────────────────────────────────────

  let body: { doc_type: string; front_base64: string; back_base64: string; selfie_base64: string }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const { front_base64, back_base64, selfie_base64 } = body
  if (!front_base64 || !back_base64 || !selfie_base64) {
    return err('MISSING_PHOTOS', 'Todas as fotos são obrigatórias', 400)
  }

  // ── Descriptografar chave API ────────────────────────────────────────────────

  let apiKey: string
  try {
    apiKey = await aesDecrypt(user.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
  } catch {
    return err('DECRYPT_FAILED', 'Erro ao descriptografar chave', 500)
  }

  // ── Upload identificação (frente + verso) ─────────────────────────────────

  try {
    const idForm = new FormData()
    idForm.append('type', 'IDENTIFICATION')
    idForm.append('documentFile',     base64ToBlob(front_base64), 'front.jpg')
    idForm.append('documentFileBack', base64ToBlob(back_base64),  'back.jpg')

    const idRes = await fetch(`${asaasBase()}/myAccount/documents`, {
      method:  'POST',
      headers: { 'access_token': apiKey },
      body:    idForm,
    })

    if (!idRes.ok) {
      const data = await idRes.json().catch(() => ({}))
      console.error('[kyc-submit] id upload failed:', idRes.status, JSON.stringify(data))
      return err('ASAAS_ID_FAILED', 'Erro ao enviar documento de identificação', 502)
    }
  } catch (e) {
    console.error('[kyc-submit] id upload exception:', e)
    return err('ASAAS_ID_FAILED', 'Erro de conexão ao enviar documento', 502)
  }

  // ── Upload selfie ─────────────────────────────────────────────────────────

  try {
    const selfieForm = new FormData()
    selfieForm.append('type', 'SELFIE')
    selfieForm.append('documentFile', base64ToBlob(selfie_base64), 'selfie.jpg')

    const selfieRes = await fetch(`${asaasBase()}/myAccount/documents`, {
      method:  'POST',
      headers: { 'access_token': apiKey },
      body:    selfieForm,
    })

    if (!selfieRes.ok) {
      const data = await selfieRes.json().catch(() => ({}))
      console.error('[kyc-submit] selfie upload failed:', selfieRes.status, JSON.stringify(data))
      return err('ASAAS_SELFIE_FAILED', 'Erro ao enviar selfie', 502)
    }
  } catch (e) {
    console.error('[kyc-submit] selfie upload exception:', e)
    return err('ASAAS_SELFIE_FAILED', 'Erro de conexão ao enviar selfie', 502)
  }

  // ── Atualizar status ──────────────────────────────────────────────────────

  await supabaseAdmin
    .from('users')
    .update({ kyc_status: 'submitted' })
    .eq('id', user.id)

  return json({ ok: true })
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function base64ToBlob(base64: string): Blob {
  const clean = base64.replace(/^data:[^;]+;base64,/, '')
  const bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0))
  return new Blob([bytes], { type: 'image/jpeg' })
}
