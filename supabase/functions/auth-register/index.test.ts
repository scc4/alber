// E2E unit tests — auth-register Edge Function
// Roda com: deno test supabase/functions/auth-register/index.test.ts --allow-env --allow-net
//
// Cobre em especial dois bugs de cadastro corrigidos:
// - ETAPA 6 (login automático pós-cadastro) com retry (item 4a do plano do bug de crash no app)
// - resposta 201 com login_required:true quando o login falha mesmo após o retry
// - pix_key gravada com o MESMO secret (ENCRYPTION_KEY) usado por todo o resto do
//   sistema (financial-carregar, financial-descarregar, user-profile, perfil-update-pix,
//   financial-create-pix-key, webhooks-asaas-kyc) — regressão do bug reportado pelo
//   usuário "dniel" (QR code do Pix não aparecia ao carregar)

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')
Deno.env.set('ASAAS_API_KEY', 'test-asaas-parent-key')
Deno.env.set('ASAAS_ENVIRONMENT', 'sandbox')
Deno.env.set('ASAAS_WEBHOOK_SECRET', 'test-webhook-secret')
Deno.env.set('ENCRYPTION_KEY', 'test-encryption-key') // secret diferente de ASAAS_API_KEY, de propósito

import { handleRequest } from './index.ts'
import { aesDecrypt } from '../_shared/crypto.ts'

// ── Mock factory ──────────────────────────────────────────────────────────────
// Suporta rotas estáticas (mesma resposta sempre) e rotas em sequência
// (respostas diferentes a cada chamada — necessário para simular retry).

type MockRoute = {
  pattern: string
  method?: string
  status:  number
  body:    unknown
}

type SequenceRoute = {
  pattern:   string
  method?:   string
  responses: { status: number; body: unknown }[] // consumidas em ordem; a última repete
}

function mockFetch(routes: MockRoute[], sequences: SequenceRoute[] = []) {
  const seqState = sequences.map(s => ({ ...s, idx: 0 }))
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET')).toUpperCase()

    for (const s of seqState) {
      const methodOk = !s.method || s.method.toUpperCase() === method
      if (methodOk && url.includes(s.pattern)) {
        const step = s.responses[Math.min(s.idx, s.responses.length - 1)]
        s.idx++
        return new Response(JSON.stringify(step.body), {
          status:  step.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    for (const r of routes) {
      const methodOk = !r.method || r.method.toUpperCase() === method
      if (methodOk && url.includes(r.pattern)) {
        return new Response(JSON.stringify(r.body), {
          status:  r.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }
}

function withMock<T>(routes: MockRoute[], sequences: SequenceRoute[], fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch
  globalThis.fetch = mockFetch(routes, sequences) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_CPF   = '52998224725' // válido conforme utils/cpf.ts — dígito verificador correto
const ASAAS_ACCOUNT = { id: 'asaas-acc-1', walletId: 'wallet-1', apiKey: null } // apiKey null → pula espera de 15s do onboardingUrl
const NEW_AUTH_USER = { id: '11111111-1111-4111-8111-111111111111', email: 'novo@teste.com' }
const NEW_DB_USER   = { id: '22222222-2222-4222-8222-222222222222' }
const SIGN_IN_OK    = { access_token: 'access-tok-1', refresh_token: 'refresh-tok-1' }
const SIGN_IN_FAIL  = { error: 'invalid_grant', error_description: 'rate limited' }

// Rotas comuns a qualquer cadastro que chega até a ETAPA 6 (sem duplicidade, sem retomada)
const BASE_ROUTES: MockRoute[] = [
  { pattern: '/rest/v1/pending_registrations',    method: 'GET',  status: 200, body: [] },
  { pattern: '/rest/v1/users',                    method: 'GET',  status: 200, body: [] },
  { pattern: 'sandbox.asaas.com/api/v3/accounts',  method: 'POST', status: 200, body: ASAAS_ACCOUNT },
  { pattern: '/auth/v1/admin/users',               method: 'POST', status: 200, body: NEW_AUTH_USER },
  { pattern: '/rest/v1/users',                     method: 'POST', status: 201, body: NEW_DB_USER },
  { pattern: '/rest/v1/security_questions',        method: 'POST', status: 201, body: {} },
  { pattern: '/auth/v1/admin/users',                method: 'PUT',  status: 200, body: NEW_AUTH_USER },
  { pattern: '/rest/v1/audit_logs',                method: 'POST', status: 201, body: {} },
]

function makeReq(overrides: Record<string, unknown> = {}): Request {
  const body = {
    name:       'Fulano de Tal',
    email:      'novo@teste.com',
    cpf:        VALID_CPF,
    birth_date: '1990-01-01',
    phone:      '11999999999',
    address: {
      street: 'Rua X', number: '100', neighborhood: 'Centro',
      zip_code: '01000000', city: 'São Paulo', state: 'SP',
    },
    handle:   'fulano',
    pin_hash: 'a'.repeat(64), // formato de sha256hex — conteúdo não importa para o mock
    security_questions: [
      { question: 'q1', answer_hash: 'h1', answer_text: 'resp1' },
      { question: 'q2', answer_hash: 'h2', answer_text: 'resp2' },
      { question: 'q3', answer_hash: 'h3', answer_text: 'resp3' },
      { question: 'q4', answer_hash: 'h4', answer_text: 'resp4' },
    ],
    pix_key:        VALID_CPF,
    pix_key_type:   'cpf',
    terms_accepted: true,
    ...overrides,
  }
  return new Request('http://localhost/auth-register', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

// ── Tests — validação estrutural (regressão do refactor p/ handleRequest) ─────

Deno.test('CORS preflight retorna 200', async () => {
  const req = new Request('http://localhost/auth-register', { method: 'OPTIONS' })
  const res = await withMock([], [], () => handleRequest(req))
  assertEquals(res.status, 200)
})

Deno.test('GET retorna 405', async () => {
  const req = new Request('http://localhost/auth-register', { method: 'GET' })
  const res  = await withMock([], [], () => handleRequest(req))
  const data = await res.json()
  assertEquals(res.status, 405)
  assertEquals(data.code, 'METHOD_NOT_ALLOWED')
})

Deno.test('JSON inválido → 400', async () => {
  const req = new Request('http://localhost/auth-register', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    '{bad json',
  })
  const res  = await withMock([], [], () => handleRequest(req))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_BODY')
})

Deno.test('campos obrigatórios ausentes → 400', async () => {
  const res  = await withMock([], [], () => handleRequest(makeReq({ name: '' })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'MISSING_FIELDS')
})

Deno.test('termos não aceitos → 400', async () => {
  const res  = await withMock([], [], () => handleRequest(makeReq({ terms_accepted: false })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'TERMS_NOT_ACCEPTED')
})

Deno.test('menos de 4 perguntas de segurança → 400', async () => {
  const res  = await withMock([], [], () => handleRequest(makeReq({ security_questions: [{ question: 'q1', answer_hash: 'h1' }] })))
  const data = await res.json()
  assertEquals(res.status, 400)
  assertEquals(data.code, 'INVALID_SECURITY_QUESTIONS')
})

Deno.test('CPF inválido → 422', async () => {
  const res  = await withMock([], [], () => handleRequest(makeReq({ cpf: '12345678900' })))
  const data = await res.json()
  assertEquals(res.status, 422)
  assertEquals(data.code, 'CPF_INVALID')
})

Deno.test('CPF duplicado → 409', async () => {
  const routes: MockRoute[] = [
    { pattern: '/rest/v1/pending_registrations', method: 'GET', status: 200, body: [] },
    { pattern: '/rest/v1/users',                 method: 'GET', status: 200, body: [{ id: 'existing-user' }] },
  ]
  const res  = await withMock(routes, [], () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 409)
  assertEquals(data.code, 'CPF_DUPLICATE')
})

// ── Tests — bug do login pós-cadastro (item 1-3 e 4a do plano) ────────────────

Deno.test('cadastro completo — login na 1ª tentativa → token presente, sem login_required', async () => {
  const routes = [
    ...BASE_ROUTES,
    { pattern: '/auth/v1/token', method: 'POST', status: 200, body: SIGN_IN_OK },
  ]
  const res  = await withMock(routes, [], () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 201)
  assertEquals(data.token, 'access-tok-1')
  assertEquals(data.refresh_token, 'refresh-tok-1')
  assertEquals(data.login_required, undefined)
  assertEquals(data.user_id, '22222222-2222-4222-8222-222222222222')
})

Deno.test('login falha na 1ª tentativa e recupera no retry → token presente (valida o fix 4a)', async () => {
  const routes = BASE_ROUTES
  const sequences: SequenceRoute[] = [
    {
      pattern: '/auth/v1/token',
      method:  'POST',
      responses: [
        { status: 500, body: SIGN_IN_FAIL }, // 1ª tentativa falha (ex.: rate-limit transitório)
        { status: 200, body: SIGN_IN_OK },    // retry recupera
      ],
    },
  ]
  const res  = await withMock(routes, sequences, () => handleRequest(makeReq()))
  const data = await res.json()
  assertEquals(res.status, 201)
  assertEquals(data.token, 'access-tok-1')
  assertEquals(data.refresh_token, 'refresh-tok-1')
  assertEquals(data.login_required, undefined)
})

Deno.test('login falha nas 2 tentativas → 201 com login_required:true e token null (não é mais um crash no app)', async () => {
  const routes = BASE_ROUTES
  const sequences: SequenceRoute[] = [
    {
      pattern: '/auth/v1/token',
      method:  'POST',
      responses: [
        { status: 500, body: SIGN_IN_FAIL },
        { status: 500, body: SIGN_IN_FAIL },
      ],
    },
  ]
  const res  = await withMock(routes, sequences, () => handleRequest(makeReq()))
  const data = await res.json()
  // A conta já foi criada com sucesso (Asaas + auth.users + public.users) —
  // por isso a resposta continua 201, não um erro.
  assertEquals(res.status, 201)
  assertEquals(data.user_id, '22222222-2222-4222-8222-222222222222')
  assertEquals(data.token, null)
  assertEquals(data.refresh_token, null)
  assertEquals(data.login_required, true)
})

// ── Tests — bug do QR code Pix não aparecer no Carregar (reportado por "dniel") ─
// Causa raiz: pix_key era gravada no cadastro com ASAAS_API_KEY, mas todo o
// resto do sistema (financial-carregar, financial-descarregar, user-profile,
// perfil-update-pix, financial-create-pix-key, webhooks-asaas-kyc) lê/grava
// pix_key com ENCRYPTION_KEY — um secret diferente. A descriptografia com o
// secret errado falha (AES-GCM rejeita o auth tag), e o carregamento nunca
// chega a chamar a Asaas.

Deno.test('pix_key gravada no cadastro é decriptável com ENCRYPTION_KEY (o secret usado pelo resto do sistema)', async () => {
  let capturedUsersInsertBody: Record<string, unknown> | null = null

  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()

    if (method === 'POST' && url.includes('/rest/v1/users')) {
      capturedUsersInsertBody = JSON.parse(init!.body as string)
      return new Response(JSON.stringify(NEW_DB_USER), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }

    for (const r of [
      ...BASE_ROUTES.filter(r => !(r.pattern === '/rest/v1/users' && r.method === 'POST')),
      { pattern: '/auth/v1/token', method: 'POST', status: 200, body: SIGN_IN_OK },
    ]) {
      const methodOk = !r.method || r.method.toUpperCase() === method
      if (methodOk && url.includes(r.pattern)) {
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }) as typeof fetch

  const PIX_KEY_PLAINTEXT = VALID_CPF
  try {
    const res = await handleRequest(makeReq({ pix_key: PIX_KEY_PLAINTEXT, pix_key_type: 'cpf' }))
    assertEquals(res.status, 201)
  } finally {
    globalThis.fetch = orig
  }

  const insertedPixKeyEnc = capturedUsersInsertBody!.pix_key as string
  const decryptedWithRightSecret = await aesDecrypt(insertedPixKeyEnc, 'test-encryption-key')
  assertEquals(decryptedWithRightSecret, PIX_KEY_PLAINTEXT)

  // Trava de regressão explícita: se alguém voltar a usar ASAAS_API_KEY para
  // criptografar pix_key, a decriptografia abaixo com o secret ERRADO não
  // deve mais bater — confirmando que os dois secrets realmente divergem.
  let decryptedWithWrongSecret: string | null = null
  try {
    decryptedWithWrongSecret = await aesDecrypt(insertedPixKeyEnc, 'test-asaas-parent-key')
  } catch { /* esperado: falha de autenticação do AES-GCM */ }
  assertNotEquals(decryptedWithWrongSecret, PIX_KEY_PLAINTEXT)
})
