// Spec: /specs/03_backend.md §4.1
// Spec: /specs/04_api_asaas.md §4.1
// Spec: /specs/05_security.md §7

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../../_shared/cpf.ts'
import { sha256hex, bcryptHash, aesEncrypt } from '../../_shared/crypto.ts'
import { createAsaasAccount } from '../../_shared/asaas.ts'

interface AddressDTO {
  street: string
  number: string
  complement?: string
  neighborhood: string
  zip_code: string
  city: string
  state: string
}

interface RegisterRequest {
  name: string
  email: string
  cpf: string
  birth_date: string
  phone: string
  address: AddressDTO
  handle: string
  pin_hash: string
  security_questions: { question: string; answer_hash: string }[]
  pix_key: string
  pix_key_type: 'cpf' | 'phone' | 'email' | 'random'
  terms_accepted: boolean
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  let body: RegisterRequest
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  // ── Validações básicas ───────────────────────────────────────────────────────

  const {
    name, email, cpf, birth_date, phone, address,
    handle, pin_hash, security_questions, pix_key, pix_key_type, terms_accepted,
  } = body

  if (!name || !email || !cpf || !birth_date || !phone || !handle || !pin_hash) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }

  if (!terms_accepted) {
    return err('TERMS_NOT_ACCEPTED', 'Termos de uso não aceitos', 400)
  }

  if (!security_questions || security_questions.length !== 4) {
    return err('INVALID_SECURITY_QUESTIONS', '4 perguntas de segurança são obrigatórias', 400)
  }

  // ── Validar CPF (algoritmo dígitos verificadores) ────────────────────────────

  const cpfClean = normalizeCpf(cpf)
  if (!validateCpf(cpfClean)) {
    return err('CPF_INVALID', 'CPF inválido', 422)
  }

  // ── Hash do CPF para armazenamento (spec 05_security §7) ────────────────────

  const cpfHash = await sha256hex(cpfClean)

  // ── Verificar duplicatas ─────────────────────────────────────────────────────

  const { data: existingCpf } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('cpf', cpfHash)
    .maybeSingle()

  if (existingCpf) return err('CPF_DUPLICATE', 'CPF já cadastrado', 409)

  const handleNorm = handle.toLowerCase().replace(/^@/, '')

  const { data: existingHandle } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('handle', `@${handleNorm}`)
    .maybeSingle()

  if (existingHandle) return err('HANDLE_TAKEN', 'Handle já em uso', 409)

  // ── Criar subconta no Asaas (spec 04_api §4.1) ──────────────────────────────
  // Feito primeiro: se falhar, nenhum registro Supabase é criado.

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const webhookUrl  = `${supabaseUrl}/functions/v1/webhooks/asaas-pix`

  let asaasAccount: { id: string; apiKey: string; walletId: string }
  try {
    asaasAccount = await createAsaasAccount(
      {
        name,
        email,
        cpfCnpj:       cpfClean,          // Asaas recebe CPF em texto puro
        birthDate:     birth_date,
        phone:         phone.replace(/\D/g, ''),
        mobilePhone:   phone.replace(/\D/g, ''),
        address:       address?.street ?? '',
        addressNumber: address?.number ?? 'S/N',
        complement:    address?.complement,
        province:      address?.neighborhood ?? '',
        postalCode:    (address?.zip_code ?? '').replace(/\D/g, ''),
        webhookUrl,
        webhookSecret: Deno.env.get('ASAAS_WEBHOOK_SECRET')!,
      },
      Deno.env.get('ASAAS_API_KEY')!,
    )
  } catch (e) {
    console.error('Asaas account creation failed:', e)
    return err('ASAAS_ERROR', 'Erro ao criar subconta financeira', 503)
  }

  // ── Criptografar API key da subconta (spec 05_security §7) ──────────────────

  const encSecret = Deno.env.get('ASAAS_API_KEY')! // Usa a master key como segredo AES
  const asaasApiKeyEnc = await aesEncrypt(asaasAccount.apiKey, encSecret)

  // Criptografar chave Pix do usuário
  const pixKeyEnc = pix_key ? await aesEncrypt(pix_key, encSecret) : null

  // ── bcrypt do PIN (spec 05_security §7: bcrypt cost 12) ─────────────────────
  // pin_hash já é SHA-256 do app; BFF aplica bcrypt antes de salvar.

  const pinBcrypt = await bcryptHash(pin_hash)

  // ── Criar usuário no Supabase Auth ───────────────────────────────────────────

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    // Senha aleatória — nunca usada (autenticação por PIN customizado)
    password: crypto.randomUUID() + crypto.randomUUID(),
    user_metadata: { name, handle: `@${handleNorm}` },
  })

  if (authError || !authData.user) {
    console.error('Auth user creation failed:', authError)
    return err('AUTH_ERROR', 'Erro ao criar usuário', 500)
  }

  const authUserId = authData.user.id

  // ── Inserir na tabela users ──────────────────────────────────────────────────

  const { data: newUser, error: userError } = await supabaseAdmin
    .from('users')
    .insert({
      auth_id:          authUserId,
      asaas_account_id: asaasAccount.id,
      asaas_wallet_id:  asaasAccount.walletId,
      asaas_api_key_enc: asaasApiKeyEnc,
      name,
      email,
      cpf:              cpfHash,
      phone:            phone.replace(/\D/g, ''),
      birth_date,
      handle:           `@${handleNorm}`,
      pix_key:          pixKeyEnc,
      pix_key_type:     pix_key_type ?? null,
      kyc_status:       'pending',
      account_status:   'evaluation',
    })
    .select('id')
    .single()

  if (userError || !newUser) {
    // Rollback: remover auth user
    await supabaseAdmin.auth.admin.deleteUser(authUserId)
    console.error('User insert failed:', userError)
    return err('DB_ERROR', 'Erro ao salvar usuário', 500)
  }

  const userId = newUser.id

  // ── Inserir PIN (em tabela separada para isolamento de segurança) ────────────
  // Nota: PIN armazenado na tabela users.pin_hash seria mais direto,
  // mas como a migration não inclui essa coluna, armazenamos em metadata.
  // TODO Sprint 7.1: adicionar coluna pin_hash à tabela users via migration.
  // Por ora, PIN validado comparando com hash armazenado em user_metadata Supabase Auth.

  await supabaseAdmin.auth.admin.updateUser(authUserId, {
    app_metadata: { pin_bcrypt: pinBcrypt },
  })

  // ── Inserir perguntas de segurança ───────────────────────────────────────────

  const questionsToInsert = await Promise.all(
    security_questions.map(async (q, i) => ({
      user_id:     userId,
      question:    q.question,
      answer_hash: await bcryptHash(q.answer_hash), // bcrypt da hash SHA-256 recebida
      position:    i + 1,
    }))
  )

  const { error: qError } = await supabaseAdmin
    .from('security_questions')
    .insert(questionsToInsert)

  if (qError) {
    console.error('Security questions insert failed:', qError)
    // Não faz rollback — registro parcial pode ser reprocessado
  }

  // ── Log de auditoria ─────────────────────────────────────────────────────────

  await supabaseAdmin.from('audit_logs').insert({
    user_id:    userId,
    event_type: 'register',
    metadata:   { handle: `@${handleNorm}`, asaas_account_id: asaasAccount.id },
  })

  // ── Gerar sessão JWT ─────────────────────────────────────────────────────────

  const { data: session, error: sessionError } = await supabaseAdmin.auth.admin.createSession({
    user_id: authUserId,
  })

  if (sessionError || !session) {
    console.error('Session creation failed:', sessionError)
    return err('SESSION_ERROR', 'Erro ao gerar sessão', 500)
  }

  return json(
    {
      user_id:        userId,
      token:          session.access_token,
      refresh_token:  session.refresh_token,
      kyc_status:     'pending',
      account_status: 'evaluation',
    },
    201,
  )
})
