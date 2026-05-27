// Spec: /specs/03_backend.md §4.1
// Spec: /specs/04_api_asaas.md §4.1
// Spec: /specs/05_security.md §7

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../_shared/cpf.ts'
import { sha256hex, bcryptHash, aesEncrypt } from '../_shared/crypto.ts'
import { createAsaasAccount, getAsaasAccountByCpf } from '../_shared/asaas.ts'

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

  const { data: existingEmail } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existingEmail) return err('EMAIL_IN_USE', 'Este e-mail já está em uso', 409)

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

  console.log('[auth-register] asaas payload:', JSON.stringify({
    name,
    email,
    cpfCnpj:       `${cpfClean.slice(0, 3)}***`,
    birthDate:     birth_date,
    phone:         phone.replace(/\D/g, '').slice(0, 2) + '***',
    address:       address?.street ?? '',
    addressNumber: address?.number ?? 'S/N',
    province:      address?.neighborhood ?? '',
    postalCode:    (address?.zip_code ?? '').replace(/\D/g, ''),
    webhookUrl,
  }))

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
        incomeValue:   1000,
        webhookUrl,
        webhookSecret: Deno.env.get('ASAAS_WEBHOOK_SECRET')!,
      },
      Deno.env.get('ASAAS_API_KEY')!,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[auth-register] asaas account creation failed:', msg)

    let description = ''
    try {
      const jsonStr = msg.replace(/^ASAAS_ACCOUNT_CREATE_FAILED:\s*/, '')
      const parsed  = JSON.parse(jsonStr) as { errors?: { description?: string }[] }
      description   = parsed.errors?.[0]?.description ?? ''
    } catch { /* mensagem não estruturada */ }

    const lower      = description.toLowerCase()
    const isEmailDup = lower.includes('já está em uso') && (lower.includes('e-mail') || lower.includes('email'))
    const isCpfDup   = lower.includes('já está em uso') && (lower.includes('cpf') || lower.includes('cnpj'))

    if (isEmailDup || isCpfDup) {
      // Subconta criada no Asaas mas não persistida no banco (falha anterior) — recuperar
      console.log('[auth-register] subconta já existe no Asaas, recuperando via CPF...')
      try {
        const existing = await getAsaasAccountByCpf(cpfClean, Deno.env.get('ASAAS_API_KEY')!)
        if (existing) {
          console.log('[auth-register] subconta recuperada:', existing.id)
          asaasAccount = existing
          // Continua o fluxo normal após o try/catch
        } else {
          return err(isEmailDup ? 'EMAIL_IN_USE' : 'CPF_IN_USE', description, 409)
        }
      } catch {
        return err(isEmailDup ? 'EMAIL_IN_USE' : 'CPF_IN_USE', description, 409)
      }
    } else {
      return err('ASAAS_ERROR', description || 'Erro ao criar subconta financeira', 503)
    }
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
    // pin_hash como senha — permite autenticar via /auth/v1/token para emitir JWT
    password: pin_hash,
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

  await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    app_metadata: { pin_bcrypt: pinBcrypt },
  })

  // ── Inserir perguntas de segurança ───────────────────────────────────────────

  const questionsToInsert = await Promise.all(
    security_questions.map(async (q, i) => ({
      user_id:     userId,
      question:    q.question,
      answer_hash: await bcryptHash(q.answer_hash, 6), // cost 6 — 2º fator, não senha principal
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

  // ── Gerar sessão JWT via password flow ──────────────────────────────────────
  // createSession não existe no SDK — autenticar com email+pin_hash (senha definida no createUser)

  const signInRes = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
      },
      body: JSON.stringify({ email, password: pin_hash }),
    },
  )

  if (!signInRes.ok) {
    const signInErr = await signInRes.json().catch(() => ({}))
    console.error('Session creation failed:', signInErr)
    return err('SESSION_ERROR', 'Erro ao gerar sessão', 500)
  }

  const { access_token, refresh_token } = await signInRes.json() as {
    access_token: string
    refresh_token: string
  }

  return json(
    {
      user_id:        userId,
      token:          access_token,
      refresh_token:  refresh_token,
      kyc_status:     'pending',
      account_status: 'evaluation',
    },
    201,
  )
})
