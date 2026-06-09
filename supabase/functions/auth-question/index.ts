// Retorna textos das perguntas de segurança para um identificador (cpf ou handle)
// Não requer autenticação — textos das perguntas não são informação sensível
// Usado no fluxo de login para mostrar a pergunta real antes da validação

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'
import { validateCpf, normalizeCpf } from '../_shared/cpf.ts'
import { sha256hex } from '../_shared/crypto.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return json({ questions: [] })

  let body: { identifier: string }
  try {
    body = await req.json()
  } catch {
    return json({ questions: [] })
  }

  const { identifier } = body
  if (!identifier || typeof identifier !== 'string') return json({ questions: [] })

  // Detectar tipo de identificador
  const cpfClean    = normalizeCpf(identifier)
  const handleClean = identifier.replace(/^@/, '').toLowerCase()
  const isHandleId  = !validateCpf(cpfClean) && /^[a-z][a-z0-9_]{2,}$/.test(handleClean)

  if (!validateCpf(cpfClean) && !isHandleId) return json({ questions: [] })

  // Localizar user_id
  let userId: string | null = null

  if (isHandleId) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('handle', handleClean)
      .maybeSingle()
    userId = data?.id ?? null
  } else {
    const cpfHash = await sha256hex(cpfClean)
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('cpf', cpfHash)
      .maybeSingle()
    userId = data?.id ?? null
  }

  if (!userId) return json({ questions: [] })

  // Buscar textos das perguntas (sem answer_hash)
  const { data: rows } = await supabaseAdmin
    .from('security_questions')
    .select('position, question')
    .eq('user_id', userId)
    .order('position')

  return json({
    questions: (rows ?? []).map(r => ({
      position: r.position as number,
      question: r.question as string,
    })),
  })
})
