// Plano CNPJ (velvet-puzzling-sedgewick)
// GET /company-invite-preview?token=...
// Endpoint público (chamado com a ANON key, sem sessão) — mostra o nome da
// empresa antes da pessoa nova começar o cadastro enxuto de operador.
// Não expõe nada sensível: só nome/nome fantasia e validade do convite.

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

  const token = new URL(req.url).searchParams.get('token')
  if (!token) return err('MISSING_FIELDS', 'token é obrigatório', 400)

  const { data: invite } = await supabaseAdmin
    .from('company_invites')
    .select('status, expires_at, companies:company_id (company_name, trading_name)')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return err('INVITE_NOT_FOUND', 'Convite não encontrado', 404)

  const expired = new Date(invite.expires_at).getTime() < Date.now()
  const valid   = invite.status === 'pending' && !expired

  const company = invite.companies as unknown as { company_name: string; trading_name: string | null } | null

  return json({
    valid,
    company_name: valid ? (company?.trading_name || company?.company_name || null) : null,
  })
})
