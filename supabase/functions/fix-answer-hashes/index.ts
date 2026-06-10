// Função temporária de manutenção: gera answer_sha256 e answer_hash
// a partir do answer_normalized existente para um usuário específico.
// Invocar uma vez e depois apagar.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256hex, bcryptHash } from '../_shared/crypto.ts'
import { handleCors, json, err } from '../_shared/cors.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  let body: { user_id: string }
  try { body = await req.json() }
  catch { return err('INVALID_BODY', 'JSON inválido', 400) }

  const { user_id } = body
  if (!user_id) return err('MISSING', 'user_id obrigatório', 400)

  const { data: rows, error } = await supabaseAdmin
    .from('security_questions')
    .select('id, position, answer_normalized')
    .eq('user_id', user_id)

  if (error || !rows?.length) return err('NOT_FOUND', 'Perguntas não encontradas', 404)

  const results = []
  for (const row of rows) {
    const normalized = row.answer_normalized as string | null
    if (!normalized) {
      results.push({ id: row.id, position: row.position, status: 'skipped (null)' })
      continue
    }

    const sha256     = await sha256hex(normalized)
    const bcryptHash_ = await bcryptHash(sha256, 6)

    const { error: updateError } = await supabaseAdmin
      .from('security_questions')
      .update({ answer_sha256: sha256, answer_hash: bcryptHash_ })
      .eq('id', row.id)

    results.push({
      id:       row.id,
      position: row.position,
      status:   updateError ? `error: ${updateError.message}` : 'updated',
      sha256,
    })
  }

  return json({ updated: results })
})
