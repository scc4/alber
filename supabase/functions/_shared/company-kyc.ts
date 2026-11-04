// Ciclo de vida do KYC de empresa (companies): aplicar o resultado e sincronizar por consulta.
// Usado pelo webhook (webhooks-asaas-kyc) e pela consulta de situação (company-list), para o Alber Food e o app verem a
// aprovação mesmo quando o webhook não chega (ou no sandbox, onde a aprovação é automática).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { aesEncrypt } from './crypto.ts'
import { decryptSubaccountKey } from './subaccount-key.ts'
import { createPixAddressKey, getAccountDocuments, getAccountGeneralStatus, type KycDocumentGroup } from './asaas.ts'
import { logError } from './error-log.ts'
import { sendPush } from './push.ts'

export interface CompanyKycRow {
  id: string
  /** Nulo em empresa aberta pelo Alber Food (sem usuário no app): nada a avisar por push. */
  owner_id: string | null
  kyc_status: string
  asaas_api_key_enc: string | null
  asaas_deposit_key: string | null
}

/** Retrato do KYC no Asaas guardado na empresa (companies.kyc_evidence): só tipo e status dos grupos e o TIPO do responsável. */
export interface KycEvidence {
  groups: Array<{ type: string; status: string; responsible_type: string | null }>
  total: number
  approved: number
  not_sent: number
}

/** O retrato só é refeito a cada 10 minutos: company-list consulta a empresa pendente a cada abertura da lista. */
export const EVIDENCE_TTL_MS = 10 * 60_000

export function summarizeEvidence(groups: KycDocumentGroup[]): KycEvidence {
  return {
    groups: groups.map((g) => ({ type: g.type, status: g.status, responsible_type: g.responsibleType })),
    total: groups.length,
    approved: groups.filter((g) => g.status === 'APPROVED').length,
    not_sent: groups.filter((g) => g.status === 'NOT_SENT').length,
  }
}

/** Tira o retrato dos documentos da subconta e grava na empresa. Melhor esforço: nunca lança e nunca derruba o fluxo do KYC. */
export async function refreshKycEvidence(
  supabaseAdmin: SupabaseClient,
  companyId: string,
  subApiKey: string,
  opts: { lastAt?: string | null; force?: boolean; now?: Date } = {},
): Promise<void> {
  try {
    const now = opts.now ?? new Date()
    if (!opts.force && opts.lastAt && now.getTime() - new Date(opts.lastAt).getTime() < EVIDENCE_TTL_MS) return
    const groups = await getAccountDocuments(subApiKey)
    if (!groups) return
    await supabaseAdmin.from('companies').update({ kyc_evidence: summarizeEvidence(groups), kyc_evidence_at: now.toISOString() }).eq('id', companyId)
  } catch (e) {
    console.warn('[company-kyc] retrato das evidências falhou (não crítico):', e instanceof Error ? e.name : 'erro')
  }
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
  // `companies` não tem onboarding_completed_at (só `users` tem): gravá-lo faz o PostgREST recusar o UPDATE inteiro (PGRST204).
  // kyc_approved_at é a data da aprovação: os primeiros 30 dias têm limites de saque menores (_shared/withdraw-guard.ts).
  if (newKycStatus === 'approved') updatePayload.kyc_approved_at = now
  if (newKycStatus === 'rejected') { updatePayload.deleted_at = now; updatePayload.deleted_reason = 'kyc_rejected' } // libera CNPJ/handle na hora: o Asaas já fez a checagem real de documentos

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
      const subApiKey = await decryptSubaccountKey(company.asaas_api_key_enc)
      const { key } = await createPixAddressKey('EVP', subApiKey)
      const encryptedKey = await aesEncrypt(key, Deno.env.get('ENCRYPTION_KEY')!)
      await supabaseAdmin.from('companies').update({ asaas_deposit_key: encryptedKey }).eq('id', company.id)
      console.log(`[company-kyc] chave Pix de recebimento (EVP) criada para empresa ${company.id}`)
    } catch (pixErr) {
      console.error('[company-kyc] falha ao criar chave Pix de recebimento da empresa (não bloqueante):', pixErr)
      await logError(supabaseAdmin, 'company-kyc', pixErr, { context: 'create_deposit_key', company_id: company.id, asaas_account_id: source.asaasAccountId })
    }
  }

  // Retrato final dos documentos para a equipe (melhor esforço; a empresa recusada continua legível no Admin com a exclusão marcada).
  if (company.asaas_api_key_enc) {
    try {
      await refreshKycEvidence(supabaseAdmin, company.id, await decryptSubaccountKey(company.asaas_api_key_enc), { force: true })
    } catch { /* chave que não decifra: segue sem o retrato */ }
  }

  if (!company.owner_id) {
    // Empresa do Alber Food: o Food lê a situação em food-company-status.
  } else if (newKycStatus === 'approved') {
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
      .select('id, owner_id, kyc_status, asaas_api_key_enc, asaas_deposit_key, asaas_account_id, kyc_evidence_at')
      .eq('id', companyId)
      .is('deleted_at', null)
      .maybeSingle()
    const c = data as (CompanyKycRow & { asaas_account_id: string | null; kyc_evidence_at: string | null }) | null
    if (!c || (c.kyc_status !== 'pending' && c.kyc_status !== 'submitted') || !c.asaas_api_key_enc) return null

    const subApiKey = await decryptSubaccountKey(c.asaas_api_key_enc)
    await refreshKycEvidence(supabaseAdmin, c.id, subApiKey, { lastAt: c.kyc_evidence_at })
    const general = await getAccountGeneralStatus(subApiKey)
    if (general !== 'APPROVED') return c.kyc_status
    const r = await applyCompanyKyc(supabaseAdmin, c, 'approved', { via: 'poll', asaasAccountId: c.asaas_account_id ?? undefined, rawStatus: general })
    return r === 'error' ? c.kyc_status : 'approved'
  } catch (e) {
    console.warn('[company-kyc] consulta de situação falhou (não crítico):', e instanceof Error ? e.name : 'erro')
    return null
  }
}
