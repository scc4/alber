// Bloqueio temporário e automático de login por tentativas excessivas de
// PIN/pergunta de segurança. Usado por auth-question (onde o PIN é validado
// silenciosamente hoje) e auth-login (validação final antes de emitir sessão)
// — os dois escrevem no mesmo contador (audit_logs por user_id + event_type),
// então uma falha detectada em qualquer um dos dois soma pro mesmo limite.
//
// Spec: /specs/05_security.md §2

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const LOGIN_BLOCK_MINUTES        = 60  // duração do bloqueio
export const FAILURE_WINDOW_MINUTES     = 15  // janela em que as falhas são contadas
export const PIN_FAILURE_THRESHOLD      = 3
export const SECURITY_FAILURE_THRESHOLD = 2

export function isCurrentlyBlocked(loginBlockedUntil: string | null | undefined): boolean {
  if (!loginBlockedUntil) return false
  return new Date(loginBlockedUntil).getTime() > Date.now()
}

// Loga a falha e, se a contagem na janela atingiu o limite, bloqueia o login
// por LOGIN_BLOCK_MINUTES (grava users.login_blocked_until). Retorna se a
// conta ficou bloqueada nesta chamada.
export async function recordFailureAndMaybeBlock(
  supabaseAdmin: SupabaseClient,
  userId: string,
  eventType: 'pin_failed' | 'security_question_failed',
  threshold: number,
): Promise<{ blocked: boolean; blockedUntil: string | null }> {
  try {
    await supabaseAdmin.from('audit_logs').insert({ user_id: userId, event_type: eventType, metadata: {} })
  } catch { /* não-crítico — segue para a contagem mesmo assim */ }

  const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000).toISOString()
  const { data: rows } = await supabaseAdmin
    .from('audit_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .gte('created_at', since) as { data: { id: string }[] | null }

  const count = rows?.length ?? 0
  if (count < threshold) return { blocked: false, blockedUntil: null }

  const blockedUntil = new Date(Date.now() + LOGIN_BLOCK_MINUTES * 60_000).toISOString()
  try {
    await supabaseAdmin.from('users').update({ login_blocked_until: blockedUntil }).eq('id', userId)
  } catch (e) {
    console.error('[login-lockout] failed to set login_blocked_until:', e)
  }
  return { blocked: true, blockedUntil }
}
