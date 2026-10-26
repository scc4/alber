// Ciclo de vida do KYC de empresa (companies): aplicar o resultado e sincronizar por consulta.
// Usado pelo webhook (webhooks-asaas-kyc) e pela consulta de situação (company-list), para o Alber Food e o app verem a
// aprovação mesmo quando o webhook não chega (ou no sandbox, onde a aprovação é automática).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { aesDecrypt, aesEncrypt } from './crypto.ts'
import { createPixAddressKey, getAccountGeneralStatus } from './asaas.ts'
import { logError } from './error-log.ts'
import { sendPush } from './push.ts'

export interface CompanyKycRow {
  id: string
  owner_id: string
  kyc_status: string
  asaas_api_key_enc: string | null
  asaas_deposit_key: string | null
}

export interface KycSource {
  /** Quem trouxe o resultado: o aviso do Asaas ou a consulta de situação. */
  via: 'webhook' | 'poll'
  asaasAccountId?: string
  event?: string
  rawStatus?: string
}

/**
 * Grava o resultado do KYC da empresa. Rejeição também marca deleted_at, liberando o CNPJ/handle (migration 044), sem
 * mexer na subconta do Asaas (decisão de produto). Aprovação cria a chave Pix de recebimento (EVP) e avisa o master.
 * Devolve 'error' se a gravação falhar (o webhook responde 500 para o Asaas reenviar).
 */
export async function applyCompanyKyc(
  supabaseAdmin: SupabaseClient,
  company: CompanyKycRow,
  newKycStatus: 'approved' | 'rejected',
  source: KycSource,
): Promise<'updated' | 'unchanged' | 'error'> {
  if (company.kyc_status === newKycStatus) return 'unchanged'

  const now = new Date().toISOString()
  const updatePayload: Record<string, unknown> = { kyc_status: newKycStatus, updated_at: now }
  if (newKycStatus === 'approved') updatePayload.onboarding_completed_at = now
  else updatePayload.deleted_at = now // libera CNPJ/handle na hora: o Asaas já fez a checagem real de documentos

  const { error: updateErr } = await supabaseAdmin.from('companies').update(updatePayload).eq('id', company.id)
  if (updateErr) {
    console.error('[company-kyc] falha ao atualizar kyc_status da empresa:', updateErr)
    await logError(supabaseAdmin, 'company-kyc', updateErr, {
      via: source.via, event: source.event, asaas_account_id: source.asaasAccountId, new_kyc_status: newKycStatus, company_id: company.id,
    })
    return 'error'
  }
  console.log(`[company-kyc] empresa ${company.id} → kyc_status="${newKycStatus}" (${source.via})`)

  // Chave Pix de RECEBIMENTO (EVP) da subconta, se ainda não tiver.
  if (newKycStatus === 'approved' && !company.asaas_deposit_key && company.asaas_api_key_enc) {
    try {
      const subApiKey = await aesDecrypt(company.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
      const { key } = await createPixAddressKey('EVP', subApiKey)
      const encryptedKey = await aesEncrypt(key, Deno.env.get('ENCRYPTION_KEY')!)
      await supabaseAdmin.from('companies').update({ asaas_deposit_key: encryptedKey }).eq('id', company.id)
      console.log(`[company-kyc] chave Pix de recebimento (EVP) criada para empresa ${company.id}`)
    } catch (pixErr) {
      console.error('[company-kyc] falha ao criar chave Pix de recebimento da empresa (não bloqueante):', pixErr)
      await logError(supabaseAdmin, 'company-kyc', pixErr, { context: 'create_deposit_key', company_id: company.id, asaas_account_id: source.asaasAccountId })
    }
  }

  if (newKycStatus === 'approved') {
    await sendPush(company.owner_id, 'Empresa verificada!', 'A verificação da sua empresa foi concluída. Já pode usar o Alber.', { route: `/(app)/empresas/${company.id}` }, undefined, 'conta_kyc')
  } else {
    await sendPush(company.owner_id, 'Verificação da empresa não aprovada', 'A verificação de identidade da empresa não foi concluída. Acesse o app para mais informações.', { route: `/(app)/empresas/${company.id}` }, undefined, 'conta_kyc')
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id: company.owner_id,
    event_type: `company_kyc_status_${newKycStatus}`,
    metadata: { company_id: company.id, asaas_account_id: source.asaasAccountId, asaas_event: source.event, asaas_status: source.rawStatus, previous_status: company.kyc_status, via: source.via },
  })
  return 'updated'
}

/**
 * Pergunta ao Asaas a situação da subconta de uma empresa ainda pendente e grava a aprovação. Só APROVA: a rejeição
 * continua vindo pelo webhook (ela apaga a empresa, então não é decidida por uma consulta). Falhas não propagam: quem
 * chama (company-list) segue com o que está no banco.
 */
export async function pollCompanyKyc(supabaseAdmin: SupabaseClient, companyId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from('companies')
      .select('id, owner_id, kyc_status, asaas_api_key_enc, asaas_deposit_key, asaas_account_id')
      .eq('id', companyId)
      .is('deleted_at', null)
      .maybeSingle()
    const c = data as (CompanyKycRow & { asaas_account_id: string | null }) | null
    if (!c || (c.kyc_status !== 'pending' && c.kyc_status !== 'submitted') || !c.asaas_api_key_enc) return null

    const subApiKey = await aesDecrypt(c.asaas_api_key_enc, Deno.env.get('ASAAS_API_KEY')!)
    const general = await getAccountGeneralStatus(subApiKey)
    if (general !== 'APPROVED') return c.kyc_status
    const r = await applyCompanyKyc(supabaseAdmin, c, 'approved', { via: 'poll', asaasAccountId: c.asaas_account_id ?? undefined, rawStatus: general })
    return r === 'error' ? c.kyc_status : 'approved'
  } catch (e) {
    console.warn('[company-kyc] consulta de situação falhou (não crítico):', e instanceof Error ? e.name : 'erro')
    return null
  }
}
