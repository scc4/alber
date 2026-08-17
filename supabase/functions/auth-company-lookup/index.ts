// POST /auth-company-lookup { identifier }
// Endpoint público (ANON key, sem sessão) — primeiro passo do login "como
// empresa": a pessoa digitou um CNPJ ou um @handle na tela de login
// (app/(auth)/login.tsx) e o app precisa saber se isso é uma empresa antes
// de decidir se mostra o seletor de operador ou segue o login pessoal normal.
//
// Nunca retorna nome em texto puro — cada operador/master sai com o nome
// mascarado (_shared/mask.ts), igual ao padrão já usado pras opções de
// pergunta de segurança em auth-question. Ver specs/06_modules/empresa_operadores.md
// §7 — a empresa não tem PIN/pergunta própria, quem autentica é sempre a
// pessoa física (master ou operador), então esta tela só resolve QUEM.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { sha256hex } from '../_shared/crypto.ts'
import { maskText } from '../_shared/mask.ts'

interface LookupRequest {
  identifier: string
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: LookupRequest
  try {
    body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }

  const identifier = (body.identifier ?? '').trim()
  if (!identifier) return json({ kind: 'not_company' })

  // ── Rate limit: máx 10 checagens por IP a cada 15 minutos ────────────────────
  // Mesmo padrão de auth-check-cpf — sem isso o endpoint vira um oráculo pra
  // enumerar CNPJs/handles de empresa válidos.

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: attempts } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'company_lookup_attempt')
    .eq('ip_address', clientIp)
    .gte('created_at', fifteenMinAgo)

  if ((attempts ?? 0) >= 10) {
    return err('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429)
  }
  await supabaseAdmin.from('audit_logs').insert({
    user_id:    null,
    event_type: 'company_lookup_attempt',
    ip_address: clientIp,
  })

  // ── Localizar empresa por @handle ou CNPJ ─────────────────────────────────────

  let companyId: string | null = null

  if (identifier.startsWith('@')) {
    const handleClean = identifier.slice(1).toLowerCase()
    const { data } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('handle', handleClean)
      .is('deleted_at', null)
      .maybeSingle()
    companyId = data?.id ?? null
  } else {
    const cnpjClean = normalizeCnpj(identifier)
    if (validateCnpj(cnpjClean)) {
      const cnpjHash = await sha256hex(cnpjClean)
      const { data } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('cnpj', cnpjHash)
        .is('deleted_at', null)
        .maybeSingle()
      companyId = data?.id ?? null
    }
  }

  if (!companyId) return json({ kind: 'not_company' })

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, company_name, trading_name, owner_id')
    .eq('id', companyId)
    .maybeSingle()

  if (!company) return json({ kind: 'not_company' })

  const { data: master } = await supabaseAdmin
    .from('users')
    .select('id, name')
    .eq('id', company.owner_id)
    .maybeSingle()

  const { data: operatorRows } = await supabaseAdmin
    .from('company_operators')
    .select('users:user_id (id, name)')
    .eq('company_id', companyId)
    .eq('status', 'active')

  const operators = [
    ...(master ? [{ ref: master.id, masked_name: maskText(master.name), role: 'master' as const }] : []),
    ...(operatorRows ?? [])
      .map(r => r.users as unknown as { id: string; name: string } | null)
      .filter((u): u is { id: string; name: string } => u != null)
      .map(u => ({ ref: u.id, masked_name: maskText(u.name), role: 'operator' as const })),
  ]

  if (operators.length === 0) return json({ kind: 'not_company' })

  return json({
    kind:         'company',
    company_id:   company.id,
    company_name: company.trading_name || company.company_name,
    operators,
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
