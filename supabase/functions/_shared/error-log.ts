import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface ErrorExtras {
  asaas_account_id?: string
  asaas_response?:   Record<string, unknown> | null
}

export async function logError(
  supabase: SupabaseClient,
  fn: string,
  error: unknown,
  payload?: Record<string, unknown> | null,
  extras?: ErrorExtras,
): Promise<void> {
  try {
    const msg  = error instanceof Error ? error.message : String(error)
    const code = (error as Record<string, unknown>)?.code as string | undefined
                 ?? (error instanceof Error ? error.name : 'UNKNOWN')
    await supabase.from('error_logs').insert({
      'function':       fn,
      error_code:       code,
      error_msg:        msg,
      payload:          payload ?? null,
      asaas_account_id: extras?.asaas_account_id ?? null,
      asaas_response:   extras?.asaas_response   ?? null,
    })
  } catch {
    // Nunca bloquear o fluxo principal por falha de log
  }
}
