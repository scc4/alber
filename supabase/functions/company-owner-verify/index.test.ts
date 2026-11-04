// Roda com: deno test supabase/functions/company-owner-verify/index.test.ts --allow-env --allow-net
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

Deno.env.set('SUPABASE_URL', 'http://localhost-test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon')

import { handleRequest } from './index.ts'
import { sha256hex } from '../_shared/crypto.ts'
import type { CnpjRegistry } from '../_shared/owner-link.ts'

const CPF = '12345678909'
const CNPJ = '11222333000181'

interface World { company?: Record<string, unknown> | null; callerId?: string; audit?: number; deleted?: boolean }

async function run(world: World, body: Record<string, unknown>, registry: CnpjRegistry | null, token: string | null = 'tok') {
  const patches: Record<string, unknown>[] = []
  const audits: Record<string, unknown>[] = []
  const company = world.company === undefined ? { id: 'c1', owner_id: 'me', cnpj: await sha256hex(CNPJ), deleted_at: null, owner_link_check: 'unchecked', owner_link_review: 'legacy' } : world.company
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    const j = init?.body ? JSON.parse(String(init.body)) : null
    const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
    if (url.includes('/auth/v1/user')) return res({ id: 'auth-1' })
    if (url.includes('/rest/v1/users')) return res({ id: world.callerId ?? 'me', cpf: await sha256hex(CPF), deleted_at: null, account_status: 'active' })
    if (url.includes('/rest/v1/audit_logs') && method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-0/${world.audit ?? 0}` } })
    if (url.includes('/rest/v1/audit_logs') && method === 'POST') { audits.push(j); return res({}, 201) }
    if (url.includes('/rest/v1/companies') && method === 'GET') return res(company)
    if (url.includes('/rest/v1/companies') && method === 'PATCH') { patches.push(j); return new Response(null, { status: 204 }) }
    return res({ error: `Unmocked ${method} ${url}` }, 500)
  }) as typeof fetch
  try {
    const req = new Request('http://localhost/company-owner-verify', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const res = await handleRequest(req, { registry: async () => registry })
    return { res, data: await res.json(), patches, audits }
  } finally {
    globalThis.fetch = orig
  }
}

const REG: CnpjRegistry = { situation: 'ATIVA', legalName: 'X LTDA', partners: [{ name: 'F', cpfMask: '***456789**', role: 'Sócio-Administrador' }] }
const ok = { company_id: 'c1', cnpj: '11.222.333/0001-81', cpf: '123.456.789-09' }

Deno.test('empresa legada, CPF certo e administrador no quadro: sai da fila (match, not_needed)', async () => {
  const r = await run({}, ok, REG)
  assertEquals(r.res.status, 200)
  assertEquals(r.data, { owner_link_check: 'match', owner_link_review: 'not_needed', changed: true })
  assertEquals(r.patches[0]?.owner_link_check, 'match')
  assertEquals(r.patches[0]?.owner_link_review, 'not_needed')
  assertEquals(JSON.stringify(r.patches).includes(CPF), false)
  assertEquals(JSON.stringify(r.audits).includes(CPF), false)
})

Deno.test('empresa legada que NÃO confere vira "pending" (agora é sinal de fraude, bloqueia)', async () => {
  const r = await run({}, ok, { ...REG, partners: [{ name: 'F', cpfMask: '***111111**', role: 'Sócio-Administrador' }] })
  assertEquals(r.data, { owner_link_check: 'mismatch', owner_link_review: 'pending', changed: true })
})

Deno.test('só o master: operador ou outro usuário recebe 403', async () => {
  const r = await run({ callerId: 'outro' }, ok, REG)
  assertEquals(r.res.status, 403)
  assertEquals(r.patches.length, 0)
})

Deno.test('o CPF tem de ser o da conta, e válido', async () => {
  assertEquals((await run({}, { ...ok, cpf: '529.982.247-25' }, REG)).res.status, 422)
  assertEquals((await run({}, { ...ok, cpf: '111.111.111-11' }, REG)).res.status, 422)
})

Deno.test('o CNPJ digitado tem de ser o da empresa', async () => {
  const r = await run({}, { ...ok, cnpj: '11.444.777/0001-61' }, REG)
  assertEquals(r.res.status, 422)
  assertEquals(r.patches.length, 0)
})

Deno.test('empresa já conferida ou aprovada pela equipe: devolve como está, sem consultar nem gravar', async () => {
  for (const review of ['not_needed', 'approved']) {
    const company = { id: 'c1', owner_id: 'me', cnpj: await sha256hex(CNPJ), deleted_at: null, owner_link_check: 'match', owner_link_review: review }
    const r = await run({ company }, ok, REG)
    assertEquals(r.data, { owner_link_check: 'match', owner_link_review: review, changed: false })
    assertEquals(r.patches.length, 0)
  }
})

Deno.test('revisão recusada pela equipe: o dono não a refaz sozinho (409)', async () => {
  const company = { id: 'c1', owner_id: 'me', cnpj: await sha256hex(CNPJ), deleted_at: null, owner_link_check: 'mismatch', owner_link_review: 'rejected' }
  const r = await run({ company }, ok, REG)
  assertEquals(r.res.status, 409)
  assertEquals(r.patches.length, 0)
})

Deno.test('consulta fora do ar: unavailable, e a empresa fica em revisão', async () => {
  const r = await run({}, ok, null)
  assertEquals(r.data, { owner_link_check: 'unavailable', owner_link_review: 'pending', changed: true })
})

Deno.test('sem token, empresa inexistente ou apagada e limite de tentativas', async () => {
  assertEquals((await run({}, ok, REG, null)).res.status, 401)
  assertEquals((await run({ company: null }, ok, REG)).res.status, 404)
  assertEquals((await run({ company: { id: 'c1', owner_id: 'me', cnpj: 'x', deleted_at: '2026-01-01', owner_link_review: 'legacy' } }, ok, REG)).res.status, 404)
  assertEquals((await run({ audit: 10 }, ok, REG)).res.status, 429)
})
