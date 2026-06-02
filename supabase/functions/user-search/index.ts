// Spec: /specs/06_modules/achar.md
// GET /user-search?q={query}
// Busca usuários por @handle (ILIKE) ou nome (ILIKE).
// Exclui o próprio usuário. Mínimo 2 chars. Máximo 10 resultados.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'GET') return err('METHOD_NOT_ALLOWED', 'Use GET', 405)

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

  // ── Buscar caller ───────────────────────────────────────────────────────────

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (!caller) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Query param ─────────────────────────────────────────────────────────────

  const url = new URL(req.url)
  const raw = (url.searchParams.get('q') ?? '').trim().replace(/^@/, '').toLowerCase()

  if (raw.length < 2) {
    return json([])
  }

  // Handles no DB têm prefixo @, ex: '@joaosilva'
  // Busca handle ILIKE '%raw%' OU name ILIKE '%raw%', excluindo o próprio usuário
  const pattern = `%${raw}%`

  const { data: users, error: searchErr } = await supabaseAdmin
    .from('users')
    .select('id, name, handle, kyc_status, created_at')
    .neq('id', caller.id)
    .or(`handle.ilike.${pattern},name.ilike.${pattern}`)
    .order('name', { ascending: true })
    .limit(10)

  if (searchErr) return err('DB_ERROR', 'Erro ao buscar usuários', 500)

  return json(
    (users ?? []).map(u => ({
      id:         u.id,
      name:       u.name,
      handle:     u.handle,
      kyc_status: u.kyc_status,
      member_since: formatMemberSince(u.created_at),
    })),
  )
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMemberSince(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toLowerCase()
  } catch {
    return ''
  }
}
