// Plano CNPJ (velvet-puzzling-sedgewick) — convite de operador por link
// Consumo do convite: chamado por auth-register depois de criar o `users`
// da pessoa nova (sem carteira pessoal), transformando o convite em uma
// linha ativa de company_operators.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type ConsumeInviteOutcome =
  | { ok: true; companyId: string }
  | { ok: false; code: string; message: string }

export async function consumeCompanyInvite(
  supabaseAdmin: SupabaseClient,
  token: string,
  newUserId: string,
): Promise<ConsumeInviteOutcome> {
  const { data: invite } = await supabaseAdmin
    .from('company_invites')
    .select('id, company_id, permissions, status, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return { ok: false, code: 'INVITE_NOT_FOUND', message: 'Convite não encontrado' }
  if (invite.status !== 'pending') return { ok: false, code: 'INVITE_UNAVAILABLE', message: 'Este convite não está mais disponível' }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, code: 'INVITE_EXPIRED', message: 'Este convite expirou' }
  }

  const { error: opErr } = await supabaseAdmin
    .from('company_operators')
    .upsert(
      { company_id: invite.company_id, user_id: newUserId, status: 'active', permissions: invite.permissions, joined_at: new Date().toISOString() },
      { onConflict: 'company_id,user_id' },
    )

  if (opErr) return { ok: false, code: 'DB_ERROR', message: 'Erro ao ativar operador' }

  await supabaseAdmin
    .from('company_invites')
    .update({ status: 'consumed', consumed_by: newUserId, consumed_at: new Date().toISOString() })
    .eq('id', invite.id)

  return { ok: true, companyId: invite.company_id }
}
