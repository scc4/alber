// Migração de dados — ÚNICA EXECUÇÃO (one-off)
// POST /admin-fix-pix-key-encryption  { dry_run?: boolean }
//
// Corrige o bug reportado pelo usuário "dniel": auth-register gravava
// users.pix_key criptografado com ASAAS_API_KEY, enquanto todo o resto do
// sistema (financial-carregar, financial-descarregar, user-profile,
// perfil-update-pix, financial-create-pix-key, webhooks-asaas-kyc) lê/grava
// pix_key com ENCRYPTION_KEY. Contas cadastradas antes da correção de código
// em auth-register ficaram com pix_key ilegível pelo resto do sistema.
//
// Para cada usuário com pix_key não nula:
//   1. Tenta decriptar com ENCRYPTION_KEY (secret correto) — se funcionar,
//      o registro já está certo (ex.: usuário trocou a chave em Perfil
//      depois do bug começar), não faz nada.
//   2. Se falhar, tenta decriptar com ASAAS_API_KEY (secret errado usado
//      pelo auth-register antigo) — se funcionar, confirma que é um
//      registro afetado: re-criptografa o MESMO valor em texto claro com
//      ENCRYPTION_KEY e regrava. A chave Pix escolhida pelo usuário no
//      cadastro é preservada, só o secret de criptografia muda.
//   3. Se nenhum dos dois secrets decripta, o valor está corrompido por
//      outro motivo — não mexe, só loga para revisão manual.
//
// Idempotente: rodar mais de uma vez é seguro (registros já corrigidos
// caem no passo 1 e são ignorados).
//
// dry_run (default true): quando true, apenas simula e retorna as contagens,
// sem gravar nada — sempre rodar dry_run primeiro para conferir os números
// antes de aplicar de fato com { "dry_run": false }.
//
// Autenticação: header x-admin-secret com o valor do secret PIX_FIX_ADMIN_SECRET
// (dedicado a esta function one-off, não reaproveita o CRON_SECRET real do scheduler).
//
// Deploy:   supabase functions deploy admin-fix-pix-key-encryption
// Chamada:  curl -X POST '<SUPABASE_URL>/functions/v1/admin-fix-pix-key-encryption' \
//             -H 'x-admin-secret: <PIX_FIX_ADMIN_SECRET>' -H 'Content-Type: application/json' \
//             -d '{"dry_run": false}'
// Remover a function do projeto depois de confirmado que rodou com sucesso —
// não é para ficar deployada permanentemente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt, aesEncrypt } from '../_shared/crypto.ts'
import { logError } from '../_shared/error-log.ts'

const PAGE_SIZE = 500

function maskPixKey(plaintext: string): string {
  return plaintext.length > 4 ? `***${plaintext.slice(-4)}` : '***'
}

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)

  // Secret dedicado a esta function one-off — não reaproveita CRON_SECRET
  // (usado pelo scheduler real) para não arriscar um valor que não temos em mãos.
  const adminSecret = Deno.env.get('PIX_FIX_ADMIN_SECRET')
  if (!adminSecret || req.headers.get('x-admin-secret') !== adminSecret) {
    return err('UNAUTHORIZED', 'Secret inválido', 401)
  }

  let body: { dry_run?: boolean } = {}
  try {
    if (req.headers.get('content-length') !== '0') body = await req.json()
  } catch {
    return err('INVALID_BODY', 'JSON inválido', 400)
  }
  const dryRun = body.dry_run !== false // default: true — precisa passar false explicitamente para gravar

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const oldSecret = Deno.env.get('ASAAS_API_KEY')!
  const newSecret = Deno.env.get('ENCRYPTION_KEY')!

  let alreadyOk = 0
  let fixed     = 0
  let unreadable = 0
  const fixedSamples:      { user_id: string; masked: string }[] = []
  const unreadableSamples: { user_id: string }[] = []

  let offset = 0
  for (;;) {
    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('id, pix_key')
      .not('pix_key', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)

    if (fetchErr) {
      await logError(supabaseAdmin, 'admin-fix-pix-key-encryption', fetchErr, {})
      return err('DB_ERROR', 'Erro ao buscar usuários', 500)
    }
    if (!rows || rows.length === 0) break

    for (const u of rows as { id: string; pix_key: string }[]) {
      // Passo 1 — já está correto?
      try {
        await aesDecrypt(u.pix_key, newSecret)
        alreadyOk++
        continue
      } catch { /* não decriptou com o secret novo — segue para o passo 2 */ }

      // Passo 2 — estava com o secret antigo (registro afetado)?
      try {
        const plaintext = await aesDecrypt(u.pix_key, oldSecret)
        if (!dryRun) {
          const reEncrypted = await aesEncrypt(plaintext, newSecret)
          const { error: updateErr } = await supabaseAdmin
            .from('users')
            .update({ pix_key: reEncrypted })
            .eq('id', u.id)
          if (updateErr) {
            await logError(supabaseAdmin, 'admin-fix-pix-key-encryption', updateErr, { user_id: u.id })
            unreadable++
            unreadableSamples.push({ user_id: u.id })
            continue
          }
        }
        fixed++
        if (fixedSamples.length < 10) fixedSamples.push({ user_id: u.id, masked: maskPixKey(plaintext) })
      } catch (e) {
        // Passo 3 — nenhum dos dois secrets decripta, valor corrompido por outro motivo
        await logError(supabaseAdmin, 'admin-fix-pix-key-encryption', e, { user_id: u.id, context: 'neither secret decrypts pix_key' })
        unreadable++
        unreadableSamples.push({ user_id: u.id })
      }
    }

    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return json({
    dry_run:    dryRun,
    already_ok: alreadyOk,
    fixed,
    unreadable,
    fixed_samples:      fixedSamples,
    unreadable_samples: unreadableSamples,
  })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
