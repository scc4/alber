// Subconta do restaurante para as cobranças do Alber Food (specs/11_spike_cobranca_subconta.md).
// A cobrança nasce NA SUBCONTA (nome do restaurante no Pix e na fatura) e a taxa Alber vai como split para a carteira da conta pai.
import { decryptSubaccountKey } from './subaccount-key.ts'
import { asaasRequest, createPixAddressKey } from './asaas.ts'
import { aesEncrypt } from './crypto.ts'

export interface FoodCompany { id: string; subKey: string }

/** Empresa viva, com KYC aprovado, conta ativa, chave da subconta e chave Pix de RECEBIMENTO (sem ela o Asaas não gera o QR Pix). */
export async function loadFoodCompany(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  companyId: string,
): Promise<{ company: FoodCompany } | { error: 'DB_ERROR' | 'COMPANY_NOT_FOUND' | 'COMPANY_NOT_APPROVED' | 'COMPANY_NO_PIX_KEY' }> {
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id, asaas_api_key_enc, asaas_deposit_key, kyc_status, account_status, deleted_at')
    .eq('id', companyId)
    .maybeSingle()
  if (error) return { error: 'DB_ERROR' }
  const c = data as { id: string; asaas_api_key_enc: string | null; asaas_deposit_key: string | null; kyc_status: string; account_status: string; deleted_at: string | null } | null
  if (!c || c.deleted_at) return { error: 'COMPANY_NOT_FOUND' }
  if (c.kyc_status !== 'approved' || c.account_status === 'blocked' || !c.asaas_api_key_enc) return { error: 'COMPANY_NOT_APPROVED' }
  const subKey = await decryptSubaccountKey(c.asaas_api_key_enc)
  if (!c.asaas_deposit_key) {
    // A chave Pix de recebimento é obrigatória (sem ela o Asaas não gera o QR). Normalmente nasce no aprovar do KYC; se aquele passo falhou
    // (melhor esforço), cria agora. Falhou de novo = a cobrança não sai e o Food mostra o erro.
    try {
      const { key } = await createPixAddressKey('EVP', subKey)
      const encKey = Deno.env.get('ENCRYPTION_KEY')
      if (encKey) await supabaseAdmin.from('companies').update({ asaas_deposit_key: await aesEncrypt(key, encKey) }).eq('id', c.id)
    } catch (e) {
      console.error('[food-subaccount] falha ao criar a chave Pix de recebimento:', e instanceof Error ? e.message : 'erro')
      return { error: 'COMPANY_NO_PIX_KEY' }
    }
  }
  return { company: { id: c.id, subKey } }
}

/**
 * Chave para consultar/estornar/cancelar uma cobrança. A empresa vem de `company_id` (se o Food mandar) ou, sem ele, do registro de auditoria que
 * takeaway-payment-create grava (referência -> empresa); assim o Food não precisa mudar. Sem nenhum dos dois (cobrança antiga, criada na conta pai) usa a chave pai.
 */
export async function keyForPayment(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  companyId: string | null,
  parentKey: string,
  reference?: string,
): Promise<{ key: string } | { error: 'DB_ERROR' | 'COMPANY_NOT_FOUND' }> {
  let id = companyId
  if (!id && reference) {
    const { data, error } = await supabaseAdmin
      .from('audit_logs').select('metadata').eq('event_type', 'takeaway_payment_created').eq('metadata->>reference', reference).limit(1)
    if (error) return { error: 'DB_ERROR' }
    const row = Array.isArray(data) ? data[0] : null
    const found = (row as { metadata?: { company_id?: unknown } } | null)?.metadata?.company_id
    id = typeof found === 'string' ? found : null
  }
  if (!id) return { key: parentKey }
  const { data, error } = await supabaseAdmin.from('companies').select('asaas_api_key_enc, deleted_at').eq('id', id).maybeSingle()
  if (error) return { error: 'DB_ERROR' }
  const c = data as { asaas_api_key_enc: string | null; deleted_at: string | null } | null
  if (!c?.asaas_api_key_enc) return { error: 'COMPANY_NOT_FOUND' }
  return { key: await decryptSubaccountKey(c.asaas_api_key_enc) }
}

/** walletId da conta pai (destino do split da taxa Alber): ASAAS_PARENT_WALLET_ID ou GET /wallets/ com a chave pai. */
export async function parentWalletId(parentKey: string): Promise<string | null> {
  const fromEnv = Deno.env.get('ASAAS_PARENT_WALLET_ID')
  if (fromEnv) return fromEnv
  const res = await asaasRequest('GET', '/wallets/', parentKey)
  const id = (res.data as { data?: { id?: string }[] })?.data?.[0]?.id
  return res.ok && typeof id === 'string' ? id : null
}
