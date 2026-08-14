// Plano CNPJ (velvet-puzzling-sedgewick)
// POST /company-set-pix-key
// Só o master configura a chave Pix de SAQUE da empresa (libera o
// financial-descarregar, que hoje retorna COMPANY_PIX_KEY_NOT_CONFIGURED
// enquanto companies.pix_key for nulo). Dois tipos, iguais ao mencionado
// no plano: CNPJ (mesmo padrão do tipo 'cpf' pessoal — não precisa de
// nenhuma chamada à Asaas, só reconfirma que o CNPJ digitado bate com o
// hash já cadastrado da empresa) ou aleatória/EVP (gera e registra uma
// chave nova na subconta da empresa via Asaas, igual financial-create-pix-key).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt, aesEncrypt, sha256hex } from '../_shared/crypto.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { createPixAddressKey } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

interface SetPixKeyRequest {
  company_id: string
  type:       'cnpj' | 'random'
  cnpj?:      string // obrigatório quando type === 'cnpj'
}

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

  // ── Parse body ──────────────────────────────────────────────────────────────

  let body: SetPixKeyRequest
  try { body = await req.json() } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }
  if (!body.company_id || !body.type || !['cnpj', 'random'].includes(body.type)) {
    return err('MISSING_FIELDS', 'company_id e type são obrigatórios', 400)
  }

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()
  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Buscar empresa — só o master pode configurar a chave de saque ────────────
  // (mais sensível que as operações do dia a dia — não delegável a operador,
  // mesmo um com a permissão "descarregar").

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, cnpj, pix_key, asaas_api_key_enc')
    .eq('id', body.company_id)
    .maybeSingle()

  if (!company) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)
  if (company.owner_id !== caller.id) return err('FORBIDDEN', 'Só o master pode configurar a chave Pix da empresa', 403)
  if (company.pix_key) return err('PIX_KEY_EXISTS', 'Chave Pix já cadastrada', 409)

  const pixKeySecret = Deno.env.get('ENCRYPTION_KEY')!

  // ── Tipo CNPJ — reconfirma que bate com o CNPJ já cadastrado da empresa ──────

  if (body.type === 'cnpj') {
    const cnpjClean = normalizeCnpj(body.cnpj ?? '')
    if (!validateCnpj(cnpjClean)) return err('CNPJ_INVALID', 'CNPJ inválido', 422)

    const cnpjHash = await sha256hex(cnpjClean)
    if (cnpjHash !== company.cnpj) {
      return err('CNPJ_MISMATCH', 'Esse CNPJ não corresponde ao cadastrado para esta empresa', 422)
    }

    const encrypted = await aesEncrypt(cnpjClean, pixKeySecret)
    const { error: updateErr } = await supabaseAdmin
      .from('companies')
      .update({ pix_key: encrypted, pix_key_type: 'cnpj' })
      .eq('id', company.id)

    if (updateErr) {
      await logError(supabaseAdmin, 'company-set-pix-key', updateErr, { company_id: company.id })
      return err('DB_ERROR', 'Erro ao salvar chave Pix', 500)
    }

    return json({ pix_key_masked: `${cnpjClean.slice(0, 8)}***`, pix_key_type: 'cnpj' })
  }

  // ── Tipo aleatória (EVP) — gera e registra na subconta da empresa ───────────

  if (!company.asaas_api_key_enc) {
    return err('ACCOUNT_NOT_CONFIGURED', 'Subconta financeira da empresa não configurada', 422)
  }

  try {
    const subApiKey = await aesDecrypt(company.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
    const { key }   = await createPixAddressKey('EVP', subApiKey)
    const encrypted = await aesEncrypt(key, pixKeySecret)

    const { error: updateErr } = await supabaseAdmin
      .from('companies')
      .update({ pix_key: encrypted, pix_key_type: 'random' })
      .eq('id', company.id)

    if (updateErr) {
      await logError(supabaseAdmin, 'company-set-pix-key', updateErr, { company_id: company.id })
      return err('DB_ERROR', 'Erro ao salvar chave Pix', 500)
    }

    return json({ pix_key_masked: `${key.slice(0, 8)}...`, pix_key_type: 'random' })
  } catch (e) {
    await logError(supabaseAdmin, 'company-set-pix-key', e, { company_id: company.id })
    return err('PIX_KEY_CREATION_FAILED', 'Não foi possível criar a chave Pix', 500)
  }
})
