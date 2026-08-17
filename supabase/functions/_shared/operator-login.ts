// Login "como empresa" (CNPJ ou @handle de empresa no auth-company-lookup) —
// a pessoa escolhe qual operador ela é (master ou operador ativo) e o app
// continua o login normal (PIN + pergunta de segurança) dessa pessoa, mas
// identificada por { company_id, operator_ref } em vez de cpf/@handle.
// Usado por auth-question e auth-login para validar que operator_ref
// realmente tem acesso a company_id antes de resolver o usuário por ele.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function isCompanyMember(
  supabaseAdmin: SupabaseClient,
  companyId: string,
  userId: string,
): Promise<boolean> {
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('owner_id')
    .eq('id', companyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!company) return false
  if (company.owner_id === userId) return true

  const { data: operator } = await supabaseAdmin
    .from('company_operators')
    .select('id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  return !!operator
}
