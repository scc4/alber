// Helper: envio de push notification via push-send EF (best-effort).
// Chamado internamente por outras Edge Functions após eventos financeiros/sociais.
// Nunca lança exceção — falha silenciosa para não bloquear o fluxo principal.

// Categoria usada só pra checar a preferência do usuário em push-send (coluna
// users.notif_<category>) — independente de `type`, que continua controlando
// o ícone na caixa de entrada in-app (ver app/(app)/notificacoes.tsx).
// Ausente = notificação não-configurável (sempre enviada): segurança
// (PIN alterado) e convites sem categoria própria na tela de preferências.
export type NotifCategory =
  | 'tx_receive' | 'tx_send' | 'tx_carregar' | 'tx_descarregar'
  | 'split_participant' | 'split_closed'
  | 'lounge_message' | 'lounge_event' | 'lounge_request'
  | 'conta_kyc'

export async function sendPush(
  userId:  string,
  title:   string,
  body:    string,
  data?:   Record<string, string>,
  type?:   'transaction' | 'invite' | 'other',
  category?: NotifCategory,
): Promise<void> {
  try {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/push-send`
    await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ user_id: userId, title, body, data, type, category }),
    })
  } catch (e) {
    console.warn('[push] sendPush failed for user', userId, e)
  }
}
