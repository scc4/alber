// Spec: /specs/06_modules/alber_lounge.md § 8.8 "Lógica de ativação automática de lotes"
// POST /cron-activate-batches  — chamado a cada 5 minutos pelo scheduler
// Ativa lotes por data cujo valid_until expirou e o lote ainda está 'active'.
//
// Deploy:  supabase functions deploy cron-activate-batches
// pg_cron: SELECT cron.schedule('activate-batches', '*/5 * * * *',
//           $$SELECT net.http_post(
//             url   := '<SUPABASE_URL>/functions/v1/cron-activate-batches',
//             headers := '{"x-cron-secret": "<CRON_SECRET>", "Content-Type": "application/json"}'::jsonb,
//             body  := '{}'::jsonb
//           )$$);

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { logError } from '../_shared/error-log.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // Autenticação via cron secret — chamado internamente pelo scheduler, não pelo app
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return err('UNAUTHORIZED', 'Invalid cron secret', 401)
  }

  const now = new Date().toISOString()

  // Buscar lotes ativos do tipo 'date' cuja validade já passou
  const { data: expiredBatches, error: fetchErr } = await supabaseAdmin
    .from('event_batches')
    .select('id, event_id, batch_number')
    .eq('status', 'active')
    .eq('batch_type', 'date')
    .lte('valid_until', now)

  if (fetchErr) {
    await logError(supabaseAdmin, 'cron-activate-batches', fetchErr, { now })
    return err('DB_ERROR', 'Erro ao buscar lotes expirados', 500)
  }

  if (!expiredBatches || expiredBatches.length === 0) {
    return json({ expired: 0, activated: 0 })
  }

  let activatedCount = 0

  for (const batch of expiredBatches) {
    try {
      // Marcar lote expirado
      await supabaseAdmin
        .from('event_batches')
        .update({ status: 'expired' })
        .eq('id', batch.id)

      // Ativar próximo lote pending
      const { data: nextBatch } = await supabaseAdmin
        .from('event_batches')
        .update({ status: 'active' })
        .eq('event_id', batch.event_id)
        .eq('batch_number', batch.batch_number + 1)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()

      if (nextBatch) {
        activatedCount++
        await supabaseAdmin.from('audit_logs').insert({
          user_id:    null,
          event_type: 'event_batch_activated',
          metadata:   {
            expired_batch_id: batch.id,
            next_batch_id:    nextBatch.id,
            event_id:         batch.event_id,
          },
        })
      }
    } catch (e) {
      await logError(supabaseAdmin, 'cron-activate-batches', e, {
        batch_id: batch.id,
        event_id: batch.event_id,
      })
    }
  }

  return json({ expired: expiredBatches.length, activated: activatedCount })
})
