// Plano CNPJ (velvet-puzzling-sedgewick)
// POST /company-set-pix-key
// Só o master configura a chave Pix de SAQUE da empresa (libera o
// financial-descarregar, que hoje retorna COMPANY_PIX_KEY_NOT_CONFIGURED
// enquanto companies.pix_key for nulo). Dois tipos, iguais ao mencionado
// no plano: CNPJ (mesmo padrão do tipo 'cpf' pessoal — não precisa de
// nenhuma chamada à Asaas, só reconfirma que o CNPJ digitado bate com o
// hash já cadastrado da empresa) ou aleatória/EVP (chave que a empresa já
// gerou no banco real dela, fora da Alber — só valida o formato e guarda
// criptografada, também sem chamada à Asaas).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import {
  aesEncrypt, sha256hex,
  bcryptVerify, tryParsePairsPayload, verifyPinWithPairs,
} from '../_shared/crypto.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { isValidEvpKey } from '../_shared/pix-key.ts'
import { logError } from '../_shared/error-log.ts'

interface SetPixKeyRequest {
  company_id:            string
  type:                  'cnpj' | 'random'
  cnpj?:                 string // obrigatório quando type === 'cnpj'
  pix_key?:              string // obrigatório quando type === 'random' — EVP já existente, gerada no banco real da empresa
  pin_hash:              string
  security_answer_hash:  string
}

// deno-lint-ignore no-explicit-any
async function logAudit(admin: any, userId: string, eventType: string, metadata: Record<string, unknown>) {
  try {
    await admin.from('audit_logs').insert({ user_id: userId, event_type: eventType, metadata })
  } catch { /* não-crítico */ }
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

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
  if (!body.pin_hash || !body.security_answer_hash) {
    return err('MISSING_FIELDS', 'pin_hash e security_answer_hash são obrigatórios', 400)
  }

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id, auth_id')
    .eq('auth_id', authUser.id)
    .maybeSingle()
  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Buscar empresa — só o master pode configurar a chave de saque ────────────
  // (mais sensível que as operações do dia a dia — não delegável a operador,
  // mesmo um com a permissão "descarregar").

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, owner_id, cnpj, pix_key')
    .eq('id', body.company_id)
    .maybeSingle()

  if (!company) return err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404)
  if (company.owner_id !== caller.id) return err('FORBIDDEN', 'Só o master pode configurar a chave Pix da empresa', 403)
  if (company.pix_key) return err('PIX_KEY_EXISTS', 'Chave Pix já cadastrada', 409)

  // ── Autenticação dupla (spec 05_security.md §4: "Cadastrar/trocar chave Pix"
  // exige PIN + confirmação de segurança) — PIN e pergunta são sempre do
  // master autenticado, nunca da empresa. Mesmo padrão de perfil-update-pix.

  const { data: authMeta } = await supabaseAdmin.auth.admin.getUserById(caller.auth_id)
  const pinBcrypt: string | undefined = authMeta?.user?.app_metadata?.pin_bcrypt
  const pinSha256: string | undefined = authMeta?.user?.app_metadata?.pin_sha256

  if (!pinBcrypt) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)

  let pinOk = false
  const pairs = tryParsePairsPayload(body.pin_hash)
  if (pairs) {
    if (!pinSha256) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)
    const result = await verifyPinWithPairs(pinSha256, pairs)
    pinOk = result.ok
  } else {
    pinOk = pinSha256 ? body.pin_hash === pinSha256 : await bcryptVerify(body.pin_hash, pinBcrypt)
  }
  if (!pinOk) {
    await logAudit(supabaseAdmin, caller.id, 'company_pix_key_pin_failed', { company_id: company.id })
    return err('INVALID_CREDENTIALS', 'PIN incorreto', 401)
  }

  const { data: questions } = await supabaseAdmin
    .from('security_questions')
    .select('answer_hash')
    .eq('user_id', caller.id)

  if (!questions?.length) return err('INVALID_CREDENTIALS', 'Credenciais inválidas', 401)

  const answerOk = (await Promise.all(
    questions.map(q => bcryptVerify(body.security_answer_hash, q.answer_hash))
  )).some(Boolean)

  if (!answerOk) {
    await logAudit(supabaseAdmin, caller.id, 'company_pix_key_security_failed', { company_id: company.id })
    return err('INVALID_CREDENTIALS', 'Resposta de segurança incorreta', 401)
  }

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

    await logAudit(supabaseAdmin, caller.id, 'company_pix_key_changed', { company_id: company.id, pix_key_type: 'cnpj' })

    return json({ pix_key_masked: `${cnpjClean.slice(0, 8)}***`, pix_key_type: 'cnpj' })
  }

  // ── Tipo aleatória (EVP) — chave já existente, gerada no banco real da
  // empresa (fora da Alber/Asaas) e colada aqui pelo master. Não gera nada
  // na subconta Asaas — só valida o formato e guarda criptografada.

  const key = (body.pix_key ?? '').trim()
  if (!isValidEvpKey(key)) return err('PIX_KEY_INVALID', 'Chave Pix aleatória inválida', 422)

  const encrypted = await aesEncrypt(key, pixKeySecret)
  const { error: updateErr } = await supabaseAdmin
    .from('companies')
    .update({ pix_key: encrypted, pix_key_type: 'random' })
    .eq('id', company.id)

  if (updateErr) {
    await logError(supabaseAdmin, 'company-set-pix-key', updateErr, { company_id: company.id })
    return err('DB_ERROR', 'Erro ao salvar chave Pix', 500)
  }

  await logAudit(supabaseAdmin, caller.id, 'company_pix_key_changed', { company_id: company.id, pix_key_type: 'random' })

  return json({ pix_key_masked: `${key.slice(0, 8)}...`, pix_key_type: 'random' })
}

Deno.serve(handleRequest)
