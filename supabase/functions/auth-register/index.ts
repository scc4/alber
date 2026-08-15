// Spec: /specs/03_backend.md §4.1
// Spec: /specs/04_api_asaas.md §4.1
// Spec: /specs/05_security.md §7

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../_shared/cpf.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { sha256hex, bcryptHash, aesEncrypt } from '../_shared/crypto.ts'
import { createAsaasAccount, getAsaasAccountByCpf, createPixAddressKey } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'
import { createCompanyForOwner, CreateCompanyInput, isValidHandleFormat } from '../_shared/company.ts'
import { consumeCompanyInvite } from '../_shared/company-invite.ts'

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
  security_questions: { question: string; answer_hash: string; answer_text?: string }[]
  pix_key?: string
  pix_key_type?: 'cpf' | 'phone' | 'email' | 'random'
  terms_accepted: boolean
  // Consentimento opcional e separado do aceite obrigatório de Termos/Privacidade
  // (item 19 da revisão de QA) — nunca pré-marcado, só true por ação explícita.
  marketing_opt_in?: boolean
  // Presente quando o cadastro escolheu "Empresa" no seletor de tipo de conta —
  // o usuário acima vira o master da empresa (plano CNPJ velvet-puzzling-sedgewick).
  company?: CreateCompanyInput
  // false quando a pessoa só quer ser master/operador de empresa, sem
  // carteira pessoal própria (plano CNPJ velvet-puzzling-sedgewick).
  // Ausente/true = comportamento de sempre (cria a subconta Asaas pessoal).
  create_personal_wallet?: boolean
  // Presente quando o cadastro veio de um link de convite de operador
  // (empresas/[id]/operadores → company-invite-link-create). Nunca cria
  // carteira pessoal nem empresa própria — só ativa o operador na empresa
  // do convite. Ignora `company` se os dois vierem juntos (não deveria).
  invite_token?: string
}

interface PendingRow {
  id: string
  asaas_account_id: string
  asaas_api_key_enc: string
  asaas_wallet_id: string
  attempts: number
}

// ── Helper: salvar/atualizar pending_registration ─────────────────────────────

async function savePending(opts: {
  supabaseAdmin: SupabaseClient
  asaasAccountId: string | null
  asaasApiKeyEnc: string | null
  asaasWalletId: string | null
  email: string
  cpfHash: string
  handle: string
  safePayload: Record<string, unknown>
  error: string
  pendingId: string | null
  currentAttempts: number
}): Promise<void> {
  try {
    if (opts.pendingId) {
      await opts.supabaseAdmin
        .from('pending_registrations')
        .update({ error: opts.error, attempts: opts.currentAttempts + 1 })
        .eq('id', opts.pendingId)
    } else {
      await opts.supabaseAdmin.from('pending_registrations').insert({
        asaas_account_id:  opts.asaasAccountId,
        asaas_api_key_enc: opts.asaasApiKeyEnc,
        asaas_wallet_id:   opts.asaasWalletId,
        email:             opts.email,
        cpf_hash:          opts.cpfHash,
        handle:            opts.handle,
        payload:           opts.safePayload,
        error:             opts.error,
        status:            'pending',
      })
    }
  } catch (e) {
    console.error('[auth-register] savePending failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: RegisterRequest
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const {
    name, email, cpf, birth_date, phone, address,
    handle, pin_hash, security_questions, pix_key, pix_key_type, terms_accepted,
    company, create_personal_wallet, invite_token, marketing_opt_in,
  } = body

  // Convite de operador nunca cria carteira pessoal nem empresa própria.
  // Ausente/true (fora do fluxo de convite) = sempre criou subconta Asaas
  // pessoal (comportamento de sempre).
  const wantsPersonalWallet = !invite_token && create_personal_wallet !== false
  const companyToCreate = invite_token ? undefined : company

  if (!name || !email || !cpf || !birth_date || !phone || !handle || !pin_hash) {
    return err('MISSING_FIELDS', 'Campos obrigatórios ausentes', 400)
  }
  if (!terms_accepted) {
    return err('TERMS_NOT_ACCEPTED', 'Termos de uso não aceitos', 400)
  }
  if (!security_questions || security_questions.length !== 4) {
    return err('INVALID_SECURITY_QUESTIONS', '4 perguntas de segurança são obrigatórias', 400)
  }

  const cpfClean = normalizeCpf(cpf)
  if (!validateCpf(cpfClean)) {
    return err('CPF_INVALID', 'CPF inválido', 422)
  }

  // ── Validação antecipada dos dados da empresa ────────────────────────────────
  // Roda ANTES de criar a conta pessoal — um CNPJ inválido/duplicado não deve
  // deixar o representante com uma conta pessoal criada e a empresa travada.
  // Falhas de infraestrutura (Asaas fora do ar etc.) continuam não-críticas e
  // são tratadas depois de a conta pessoal já existir (ETAPA 4.5).

  if (companyToCreate) {
    if (
      !companyToCreate.cnpj || !companyToCreate.handle || !companyToCreate.company_name?.trim() || !companyToCreate.company_type ||
      companyToCreate.income_value == null || !companyToCreate.address?.street || !companyToCreate.address?.number ||
      !companyToCreate.address?.neighborhood || !companyToCreate.address?.zip_code
    ) {
      return err('COMPANY_MISSING_FIELDS', 'Campos obrigatórios da empresa ausentes', 400)
    }

    const companyCnpjClean = normalizeCnpj(companyToCreate.cnpj)
    if (!validateCnpj(companyCnpjClean)) {
      return err('CNPJ_INVALID', 'CNPJ inválido', 422)
    }

    const companyCnpjHash = await sha256hex(companyCnpjClean)
    // Empresas com deleted_at (rejeitada pelo Asaas ou abandonada pelo master
    // antes da aprovação) já liberaram o CNPJ (migration 044) — não bloqueiam
    // mais. Uma linha ainda pendente bloqueia com um código diferente, pra
    // avisar que é uma verificação em andamento, não uma conta já existente.
    const { data: existingCompanyCnpj } = await supabaseAdmin
      .from('companies').select('id, kyc_status').eq('cnpj', companyCnpjHash).is('deleted_at', null).maybeSingle()
    if (existingCompanyCnpj) {
      return existingCompanyCnpj.kyc_status === 'pending'
        ? err('CNPJ_UNDER_REVIEW', 'Este CNPJ já está em processo de verificação por outra conta.', 409)
        : err('CNPJ_DUPLICATE', 'CNPJ já cadastrado', 409)
    }

    const companyHandleNorm = companyToCreate.handle.toLowerCase().replace(/^@/, '')
    if (!isValidHandleFormat(companyHandleNorm)) {
      return err('COMPANY_HANDLE_INVALID', '@handle da empresa inválido', 400)
    }
    // Compara também com o handle do próprio representante (sendo criado
    // nesta mesma requisição, ainda não existe no banco pra pegar por query).
    if (companyHandleNorm === handle.toLowerCase().replace(/^@/, '')) {
      return err('COMPANY_HANDLE_TAKEN', '@handle da empresa não pode ser igual ao seu @handle pessoal', 409)
    }
    const [{ data: handleUser }, { data: handleCompany }] = await Promise.all([
      supabaseAdmin.from('users').select('id').eq('handle', companyHandleNorm).maybeSingle(),
      supabaseAdmin.from('companies').select('id').eq('handle', companyHandleNorm).is('deleted_at', null).maybeSingle(),
    ])
    if (handleUser || handleCompany) {
      return err('COMPANY_HANDLE_TAKEN', '@handle da empresa já está em uso', 409)
    }
  }

  // ── Validação antecipada do convite de operador ──────────────────────────────
  // Mesmo raciocínio: não cria conta pessoal para um convite que já sabemos
  // que vai falhar (expirado, já usado, ou nunca existiu).

  if (invite_token) {
    const { data: invite } = await supabaseAdmin
      .from('company_invites')
      .select('status, expires_at')
      .eq('token', invite_token)
      .maybeSingle()

    if (!invite) return err('INVITE_NOT_FOUND', 'Convite não encontrado', 404)
    if (invite.status !== 'pending') return err('INVITE_UNAVAILABLE', 'Este convite não está mais disponível', 409)
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return err('INVITE_EXPIRED', 'Este convite expirou', 409)
    }
  }

  // ── Rate limit: máx 5 tentativas de cadastro por IP a cada 15 minutos ────────
  // auth-register cria uma subconta real na Asaas por chamada bem-sucedida —
  // sem esse limite, um script pode gerar CPFs válidos (checksum) em sequência
  // e forçar a criação de contas em massa sem custo pro atacante.

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: registerAttempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'register_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)

  if ((registerAttempts ?? 0) >= 5) {
    return err('RATE_LIMITED', 'Muitas tentativas de cadastro. Aguarde alguns minutos.', 429)
  }
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    null,
    event_type: 'register_attempt',
    ip_address: clientIp,
  })

  const handleNorm  = handle.toLowerCase().replace(/^@/, '')
  const cpfHash     = await sha256hex(cpfClean)
  const encSecret   = Deno.env.get('ASAAS_API_KEY')!  // Asaas parent API key — também usada p/ criptografar asaas_api_key_enc
  const pixKeySecret = Deno.env.get('ENCRYPTION_KEY')! // mesmo secret usado por todo o resto do sistema p/ pix_key

  // Payload sem campos sensíveis — armazenado apenas para diagnóstico/retomada
  const { pin_hash: _ph, security_questions: _sq, ...safePayload } = body as unknown as Record<string, unknown>

  // ── ETAPA 0: Idempotência — verificar pending_registrations ─────────────────
  // Só se aplica a quem quer carteira pessoal: a máquina de pending existe pra
  // recuperar falha parcial de criação de subconta Asaas — sem carteira
  // pessoal não há nada do lado do Asaas que possa falhar aqui.

  let pendingReg: PendingRow | null = null

  if (wantsPersonalWallet) {
    // Busca por cpf_hash primeiro (identificador primário)
    const { data: byCpf } = await supabaseAdmin
      .from('pending_registrations')
      .select('id, asaas_account_id, asaas_api_key_enc, asaas_wallet_id, attempts')
      .eq('cpf_hash', cpfHash)
      .eq('status', 'pending')
      .maybeSingle()

    if (byCpf) {
      pendingReg = byCpf as PendingRow
    } else {
      const { data: byEmail } = await supabaseAdmin
        .from('pending_registrations')
        .select('id, asaas_account_id, asaas_api_key_enc, asaas_wallet_id, attempts')
        .eq('email', email)
        .eq('status', 'pending')
        .maybeSingle()
      if (byEmail) pendingReg = byEmail as PendingRow
    }
  }

  let asaasAccountId: string | null = null
  let asaasApiKeyEnc: string | null = null
  let asaasWalletId:  string | null = null
  // Captura o response bruto do Asaas (inclui apiKey em texto claro) para que,
  // se qualquer ETAPA seguinte falhar, o error_logs contenha dados suficientes
  // para recuperação manual sem depender de pending_registrations.
  let asaasRawResponse: Record<string, unknown> | null = null
  // URL do fluxo de KYC da subconta — obtida após 15s de espera obrigatória (docs Asaas).
  // null em retomadas via pending_registrations (edge case sem impacto crítico).
  let onboardingUrl: string | null = null
  // Chave Pix EVP de RECEBIMENTO da própria subconta (distinta de pix_key, a chave de
  // saque escolhida pelo usuário) — registrada na Asaas via POST /pix/addressKeys.
  // null em retomadas ou se a Asaas ainda não permitir o registro nesta etapa (ex.: KYC
  // pendente) — nesse caso, webhooks-asaas-kyc e financial-carregar criam como fallback.
  let depositKeyEnc: string | null = null

  if (!wantsPersonalWallet) {
    // Sem carteira pessoal — ainda precisa checar duplicatas (CPF continua
    // sendo a identidade única da pessoa), só não cria nada no Asaas.
    // asaasAccountId/asaasApiKeyEnc/asaasWalletId ficam null (users.
    // asaas_account_id agora é nullable — migration 041).
    const { data: existingCpf } = await supabaseAdmin
      .from('users').select('id').eq('cpf', cpfHash).maybeSingle()
    if (existingCpf) return err('CPF_DUPLICATE', 'CPF já cadastrado', 409)

    const { data: existingEmail } = await supabaseAdmin
      .from('users').select('id').eq('email', email).maybeSingle()
    if (existingEmail) return err('EMAIL_IN_USE', 'Este e-mail já está em uso', 409)

    const { data: existingHandle } = await supabaseAdmin
      .from('users').select('id').eq('handle', handleNorm).maybeSingle()
    if (existingHandle) return err('HANDLE_TAKEN', 'Handle já em uso', 409)
  } else if (pendingReg) {
    // Retomar com dados do Asaas já salvos — pular ETAPA 1 e ETAPA 2
    console.log('[auth-register] retomando pending_registration:', pendingReg.id)
    asaasAccountId = pendingReg.asaas_account_id
    asaasApiKeyEnc = pendingReg.asaas_api_key_enc
    asaasWalletId  = pendingReg.asaas_wallet_id
  } else {
    // ── ETAPA 1: Verificações de duplicata (sem efeito colateral) ─────────────

    const { data: existingCpf } = await supabaseAdmin
      .from('users').select('id').eq('cpf', cpfHash).maybeSingle()
    if (existingCpf) return err('CPF_DUPLICATE', 'CPF já cadastrado', 409)

    const { data: existingEmail } = await supabaseAdmin
      .from('users').select('id').eq('email', email).maybeSingle()
    if (existingEmail) return err('EMAIL_IN_USE', 'Este e-mail já está em uso', 409)

    const { data: existingHandle } = await supabaseAdmin
      .from('users').select('id').eq('handle', handleNorm).maybeSingle()
    if (existingHandle) return err('HANDLE_TAKEN', 'Handle já em uso', 409)

    // ── ETAPA 2: Criar subconta no Asaas ──────────────────────────────────────

    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
    const webhookUrl   = `${supabaseUrl}/functions/v1/webhooks-asaas-kyc`
    const pixWebhookUrl = `${supabaseUrl}/functions/v1/webhooks-asaas-pix`

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
      pixWebhookUrl,
    }))

    let asaasAccount: { id: string; apiKey: string; walletId: string }
    try {
      asaasAccount = await createAsaasAccount(
        {
          name,
          email,
          cpfCnpj:       cpfClean,
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
          pixWebhookUrl,
          webhookSecret: Deno.env.get('ASAAS_WEBHOOK_SECRET')!,
        },
        encSecret,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[auth-register] asaas account creation failed:', msg)

      // Parsear e logar o body completo do Asaas para diagnóstico
      let asaasErrorBody: Record<string, unknown> | null = null
      let description = ''
      try {
        const jsonStr  = msg.replace(/^ASAAS_ACCOUNT_CREATE_FAILED:\s*/, '')
        asaasErrorBody = JSON.parse(jsonStr) as Record<string, unknown>
        const errors   = asaasErrorBody.errors as Array<{ description?: string }> | undefined
        description    = errors?.[0]?.description ?? ''
        console.error('[auth-register] asaas error body:', JSON.stringify(asaasErrorBody))
      } catch { /* mensagem não estruturada */ }

      const lower      = description.toLowerCase()
      const isEmailDup = lower.includes('já está em uso') && (lower.includes('e-mail') || lower.includes('email'))
      const isCpfDup   = lower.includes('já está em uso') && (lower.includes('cpf') || lower.includes('cnpj'))

      if (isEmailDup || isCpfDup) {
        console.log('[auth-register] subconta já existe no Asaas, recuperando via CPF...')
        try {
          const existing = await getAsaasAccountByCpf(cpfClean, encSecret)
          if (existing) {
            console.log('[auth-register] subconta recuperada:', existing.id)
            asaasAccount = existing
          } else {
            return err(isEmailDup ? 'EMAIL_IN_USE' : 'CPF_IN_USE', description, 409)
          }
        } catch (e2) {
          await logError(supabaseAdmin, 'auth-register', e2, safePayload, {
            asaas_response: asaasErrorBody,
          })
          return err(isEmailDup ? 'EMAIL_IN_USE' : 'CPF_IN_USE', description, 409)
        }
      } else {
        await logError(supabaseAdmin, 'auth-register', e, safePayload, {
          asaas_response: asaasErrorBody,
        })
        return err('ASAAS_ERROR', description || 'Erro ao criar subconta financeira', 503)
      }
    }

    asaasAccountId   = asaasAccount.id
    asaasWalletId    = asaasAccount.walletId
    asaasApiKeyEnc   = await aesEncrypt(asaasAccount.apiKey, encSecret)
    // Manter o response bruto disponível para error_logs nas etapas seguintes.
    // A apiKey em texto claro só existe aqui — após aesEncrypt ela é descartada.
    asaasRawResponse = { id: asaasAccount.id, apiKey: asaasAccount.apiKey, walletId: asaasAccount.walletId }

    console.log('[asaas] account created:', JSON.stringify({
      id:       asaasAccount.id,
      apiKey:   asaasAccount.apiKey ? '***presente***' : 'null',
      walletId: asaasAccount.walletId,
    }))
    if (!asaasAccount.apiKey) {
      console.warn('[asaas] WARNING: apiKey is null - White Label may not be enabled')
    }

    // ── Registrar chave Pix EVP de recebimento (distinta da pix_key de saque) ─
    // Best-effort: não bloqueia o cadastro. Se falhar (ex.: Asaas exigir KYC
    // aprovado antes de registrar chave — ainda não confirmado), fica null e
    // é criada depois por webhooks-asaas-kyc ou financial-carregar.
    if (asaasAccount.apiKey) {
      try {
        const { key } = await createPixAddressKey('EVP', asaasAccount.apiKey)
        depositKeyEnc = await aesEncrypt(key, pixKeySecret)
        console.log('[auth-register] chave Pix de recebimento (EVP) registrada na Asaas')
      } catch (e) {
        console.warn('[auth-register] erro ao registrar chave Pix de recebimento (não-crítico):', e)
      }
    }

    // ── Buscar onboardingUrl (aguarda 15s — obrigatório conforme docs Asaas) ──
    // Usa apiKey da SUBCONTA (asaasAccount.apiKey), nunca da conta pai.
    // Se apiKey for nulo (White Label não habilitado), pula a chamada.
    if (asaasAccount.apiKey) {
      try {
        await new Promise<void>(resolve => setTimeout(resolve, 15_000))
        const asaasBase = Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
          ? 'https://api.asaas.com/api/v3'
          : 'https://sandbox.asaas.com/api/v3'
        console.log('[auth-register] GET /myAccount/documents com apiKey da subconta:', asaasAccount.id)
        const docsRes = await fetch(`${asaasBase}/myAccount/documents`, {
          headers: { 'access_token': asaasAccount.apiKey },
        })
        if (docsRes.ok) {
          const docsData = await docsRes.json() as { onboardingUrl?: string }
          onboardingUrl = docsData.onboardingUrl ?? null
          console.log('[auth-register] onboardingUrl:', onboardingUrl ? 'obtido' : 'ausente na resposta')
        } else {
          const docsErr = await docsRes.json().catch(() => ({}))
          console.warn('[auth-register] GET /myAccount/documents status:', docsRes.status, JSON.stringify(docsErr))
        }
      } catch (e) {
        console.warn('[auth-register] erro ao buscar onboardingUrl (não-crítico):', e)
      }
    } else {
      console.warn('[auth-register] apiKey da subconta ausente — onboardingUrl não será buscado')
    }
  }

  // Campos computados a partir do request atual (mesmo em retomada)
  const pixKeyEnc = pix_key ? await aesEncrypt(pix_key, pixKeySecret) : null
  const pinBcrypt = await bcryptHash(pin_hash)

  // ── ETAPA 3: Criar usuário Supabase Auth ─────────────────────────────────────

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password:      pin_hash,   // SHA-256 do PIN — usado como senha para emitir JWT
    user_metadata: { name, handle: handleNorm },
    app_metadata:  { pin_bcrypt: pinBcrypt, pin_sha256: pin_hash },
  })

  if (authError || !authData.user) {
    console.error('[auth-register] auth user creation failed:', authError)
    await logError(supabaseAdmin, 'auth-register', authError ?? new Error('auth_create_failed'), safePayload, {
      asaas_account_id: asaasAccountId ?? undefined,
      asaas_response:   asaasRawResponse,
    })
    await savePending({
      supabaseAdmin,
      asaasAccountId, asaasApiKeyEnc, asaasWalletId,
      email, cpfHash, handle: handleNorm,
      safePayload, error: String(authError?.message ?? 'auth_create_failed'),
      pendingId: pendingReg?.id ?? null, currentAttempts: pendingReg?.attempts ?? 0,
    })
    return err('AUTH_ERROR', 'Erro temporário ao criar conta. Tente novamente.', 503)
  }

  const authUserId = authData.user.id

  // ── ETAPA 4: Inserir na tabela users ─────────────────────────────────────────

  const { data: newUser, error: userError } = await supabaseAdmin
    .from('users')
    .insert({
      auth_id:           authUserId,
      asaas_account_id:  asaasAccountId,
      asaas_wallet_id:   asaasWalletId,
      asaas_api_key_enc: asaasApiKeyEnc,
      name,
      email,
      cpf:               cpfHash,
      phone:             phone.replace(/\D/g, ''),
      birth_date,
      handle:            handleNorm,
      pix_key:           pixKeyEnc,
      pix_key_type:      pix_key_type ?? null,
      asaas_deposit_key: depositKeyEnc,
      kyc_status:        'pending',
      account_status:    'evaluation',
      onboarding_url:    onboardingUrl,
      marketing_opt_in:            marketing_opt_in === true,
      marketing_opt_in_updated_at: marketing_opt_in != null ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (userError || !newUser) {
    console.error('[auth-register] users insert failed:', userError)
    await logError(supabaseAdmin, 'auth-register', userError ?? new Error('users_insert_failed'), safePayload, {
      asaas_account_id: asaasAccountId ?? undefined,
      asaas_response:   asaasRawResponse,
    })
    await supabaseAdmin.auth.admin.deleteUser(authUserId)
    await savePending({
      supabaseAdmin,
      asaasAccountId, asaasApiKeyEnc, asaasWalletId,
      email, cpfHash, handle: handleNorm,
      safePayload, error: String(userError?.message ?? 'users_insert_failed'),
      pendingId: pendingReg?.id ?? null, currentAttempts: pendingReg?.attempts ?? 0,
    })
    return err('DB_ERROR', 'Erro temporário ao criar conta. Tente novamente.', 503)
  }

  const userId = newUser.id

  // ── ETAPA 4.5: Criar empresa (quando o cadastro escolheu "Empresa") ──────────
  // Falha aqui NÃO derruba o cadastro pessoal já criado — a subconta PJ pode
  // ser aberta depois via company-create (mesma lógica, reutilizável), sem
  // precisar repetir o onboarding pessoal. Ver _shared/company.ts.

  let companyResult: Awaited<ReturnType<typeof createCompanyForOwner>> | null = null

  if (companyToCreate) {
    companyResult = await createCompanyForOwner(supabaseAdmin, userId, companyToCreate)
    if (!companyResult.ok) {
      console.error('[auth-register] company creation failed (não-crítico para a conta pessoal):', companyResult.code, companyResult.message)
      await logError(supabaseAdmin, 'auth-register', new Error(`COMPANY_CREATE_FAILED: ${companyResult.code}`), safePayload, {
        asaas_account_id: asaasAccountId ?? undefined,
      })
    }
  }

  // ── ETAPA 4.6: Consumir convite de operador (quando veio de um link) ─────────
  // Mesma filosofia: falha aqui não derruba a conta pessoal já criada — só
  // fica sem o vínculo com a empresa, recuperável com um novo convite.

  let inviteResult: Awaited<ReturnType<typeof consumeCompanyInvite>> | null = null

  if (invite_token) {
    inviteResult = await consumeCompanyInvite(supabaseAdmin, invite_token, userId)
    if (!inviteResult.ok) {
      console.error('[auth-register] invite consumption failed (não-crítico para a conta pessoal):', inviteResult.code, inviteResult.message)
      await logError(supabaseAdmin, 'auth-register', new Error(`INVITE_CONSUME_FAILED: ${inviteResult.code}`), safePayload)
    }
  }

  // ── ETAPA 5: Inserir perguntas de segurança ───────────────────────────────────

  const questionsToInsert = await Promise.all(
    security_questions.map(async (q, i) => ({
      user_id:           userId,
      question:          q.question,
      answer_hash:       await bcryptHash(q.answer_hash, 6), // cost 6 — 2º fator, não senha principal
      answer_sha256:     q.answer_hash,                                        // sha256 exato que entrou no bcrypt
      answer_normalized: q.answer_text ? q.answer_text.toLowerCase().trim() : null,
      position:          i + 1,
    }))
  )

  const { error: qError } = await supabaseAdmin
    .from('security_questions')
    .insert(questionsToInsert)

  if (qError) {
    console.error('[auth-register] security questions insert failed:', qError)
    await logError(supabaseAdmin, 'auth-register', qError, safePayload, {
      asaas_account_id: asaasAccountId ?? undefined,
      asaas_response:   asaasRawResponse,
    })
    await supabaseAdmin.from('users').delete().eq('id', userId)
    await supabaseAdmin.auth.admin.deleteUser(authUserId)
    await savePending({
      supabaseAdmin,
      asaasAccountId, asaasApiKeyEnc, asaasWalletId,
      email, cpfHash, handle: handleNorm,
      safePayload, error: String(qError?.message ?? 'security_questions_insert_failed'),
      pendingId: pendingReg?.id ?? null, currentAttempts: pendingReg?.attempts ?? 0,
    })
    return err('DB_ERROR', 'Erro temporário ao criar conta. Tente novamente.', 503)
  }

  // PIN bcrypt + sha256 em app_metadata
  // pin_bcrypt: verificação setup mode (bcrypt cost 12)
  // pin_sha256: verificação secure mode (pairs) — apenas server-side, nunca no JWT
  try {
    await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      app_metadata: { pin_bcrypt: pinBcrypt, pin_sha256: pin_hash },
    })
  } catch (e) {
    console.error('[auth-register] updateUserById failed (non-critical):', e)
  }

  // Log de auditoria (não crítico)
  try {
    const { error: auditError } = await supabaseAdmin.from('audit_logs').insert({
      user_id:    userId,
      event_type: 'register',
      metadata:   { handle: handleNorm, asaas_account_id: asaasAccountId },
    })
    if (auditError) console.error('[auth-register] audit_log failed (non-critical):', auditError)
  } catch (e) {
    console.error('[auth-register] audit_log failed (non-critical):', e)
  }

  // ── ETAPA 6: Login e retorno do JWT ─────────────────────────────────────────
  // 1 retry rápido — a chamada é idempotente (só emite token) e falhas aqui
  // costumam ser transitórias (rate-limit do GoTrue logo após createUser).

  let access_token:  string | null = null
  let refresh_token: string | null = null
  let signInErr: unknown = null

  for (let attempt = 0; attempt < 2 && !access_token; attempt++) {
    if (attempt > 0) await new Promise<void>(resolve => setTimeout(resolve, 500))

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

    if (signInRes.ok) {
      const tokens = await signInRes.json() as { access_token: string; refresh_token: string }
      access_token  = tokens.access_token
      refresh_token = tokens.refresh_token
    } else {
      signInErr = await signInRes.json().catch(() => ({}))
    }
  }

  if (!access_token) {
    console.error('[auth-register] session creation failed after retry:', signInErr)
    // Não crítico — usuário pode fazer login manualmente
  }

  // ── ETAPA 7: Resolver pending se veio de retomada ────────────────────────────

  if (pendingReg) {
    try {
      const { error: resolveError } = await supabaseAdmin
        .from('pending_registrations')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('id', pendingReg.id)
      if (resolveError) console.error('[auth-register] resolve pending failed (non-critical):', resolveError)
    } catch (e) {
      console.error('[auth-register] resolve pending failed (non-critical):', e)
    }
  }

  return json(
    {
      user_id:        userId,
      token:          access_token,
      refresh_token:  refresh_token,
      kyc_status:     'pending',
      account_status: 'evaluation',
      onboarding_url: onboardingUrl,
      ...(access_token == null && { login_required: true }),
      ...(companyResult?.ok && {
        company_id:             companyResult.company_id,
        company_account_status: companyResult.account_status,
        company_kyc_status:     companyResult.kyc_status,
        company_onboarding_url: companyResult.onboarding_url,
      }),
      ...(companyResult && !companyResult.ok && {
        company_error: { code: companyResult.code, message: companyResult.message },
      }),
      ...(inviteResult?.ok && { company_id: inviteResult.companyId }),
      ...(inviteResult && !inviteResult.ok && {
        invite_error: { code: inviteResult.code, message: inviteResult.message },
      }),
    },
    201,
  )
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
