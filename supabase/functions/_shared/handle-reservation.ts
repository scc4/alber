// Reserva de @handle feita pelo Alber Food (ver migration 050). Consultas de leitura usadas pelas funções que
// criam ou trocam @: uma reserva de OUTRO dono bloqueia o @.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * true se o @ está reservado por alguém que não é `ownerRef`. Com `ownerRef` nulo, qualquer reserva conta.
 * Falha de leitura não bloqueia ninguém (o @ ainda passa pelas checagens de usuário e empresa); fica no log.
 */
export async function isReservedByOther(
  supabaseAdmin: SupabaseClient,
  handle: string,
  ownerRef: string | null = null,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('handle_reservations')
    .select('owner_ref')
    .eq('handle', handle)
    .maybeSingle()
  if (error) {
    console.error('[handle-reservation] leitura falhou:', error.message)
    return false
  }
  return Boolean(data) && (data as { owner_ref: string }).owner_ref !== ownerRef
}

/** Apaga a reserva do @ (o usuário foi criado com ele). Melhor esforço: não derruba o cadastro. */
export async function consumeReservation(supabaseAdmin: SupabaseClient, handle: string): Promise<void> {
  const { error } = await supabaseAdmin.from('handle_reservations').delete().eq('handle', handle)
  if (error) console.error('[handle-reservation] não consegui apagar a reserva:', error.message)
}
