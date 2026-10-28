// Saldo e extrato da conta pai no Asaas, somente leitura, para a tela Plataforma do Alber Admin.
// POST /admin-parent-balance { actor_id, actor_email } ->
//   { balance_cents, to_receive: { quantity, value_cents, net_cents } | null, movements: [...], generated_at }
//
// Só o Alber Admin chama (x-alber-admin-key). A chave do Asaas da conta pai fica aqui: o admin nunca a vê. O extrato sai sem
// descrição (que traz nome de cliente): só id, tipo, valor, saldo, data e se há cobrança ligada. Cada consulta fica no
// audit_logs do Alber com quem pediu. Não escreve em nada além do log e não movimenta dinheiro.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { requireAdminKey } from '../_shared/admin-service.ts'
import { getParentBalanceCents, getPendingStatistics, listParentMovements } from '../_shared/asaas.ts'
import { logError } from '../_shared/error-log.ts'

const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const denied = requireAdminKey(req)
  if (denied) return denied

  let body: { actor_id?: unknown; actor_email?: unknown }
  try { body = await req.json() } catch { return err('INVALID_BODY', 'JSON inválido', 400) }
  const actorId = typeof body.actor_id === 'string' ? body.actor_id : ''
  const actorEmail = typeof body.actor_email === 'string' ? body.actor_email.slice(0, 120) : ''
  if (!ACTOR_ID.test(actorId)) return err('INVALID_ACTOR', 'actor_id inválido', 422)

  const parentKey = Deno.env.get('ASAAS_API_KEY')
  if (!parentKey) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const balance_cents = await getParentBalanceCents(parentKey)
    const [to_receive, movements] = await Promise.all([getPendingStatistics(parentKey), listParentMovements(parentKey, 30)])
    await supabaseAdmin.from('audit_logs').insert({
      user_id: null,
      event_type: 'admin_parent_balance_viewed',
      metadata: { actor_id: actorId, actor_email: actorEmail },
    })
    return json({ balance_cents, to_receive, movements, generated_at: new Date().toISOString() })
  } catch (e) {
    await logError(supabaseAdmin, 'admin-parent-balance', e, { actor_id: actorId })
    return err('PARENT_BALANCE_PROVIDER_ERROR', 'Falha ao consultar o Asaas', 502)
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
