// Helper: envio de push notification via push-send EF (best-effort).
// Chamado internamente por outras Edge Functions após eventos financeiros/sociais.
// Nunca lança exceção — falha silenciosa para não bloquear o fluxo principal.

export async function sendPush(
  userId:  string,
  title:   string,
  body:    string,
  data?:   Record<string, string>,
  type?:   'transaction' | 'invite' | 'other',
): Promise<void> {
  try {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/push-send`
    await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ user_id: userId, title, body, data, type }),
    })
  } catch (e) {
    console.warn('[push] sendPush failed for user', userId, e)
  }
}
