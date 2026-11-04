// POST /food-company-set-pix-key   (Alber Food -> Alber; x-alber-food-key + autorização assinada; sem JWT de usuário)
//   { company_id, owner_ref, key_type: 'cnpj'|'random', op, cnpj?, pix_key? }
//   -> { pix_key: { configured: true, type, masked, digest, changed_at, available_at } }
//
// Cadastra a chave Pix de SAQUE da empresa. Regras de company-set-pix-key (app), mantidas:
//   - a chave só é gravada UMA vez (PIX_KEY_EXISTS, 409); o único caminho que a limpa é a troca de titular (food-company-owner-transfer);
//   - 'cnpj': o destino é a conta do próprio CNPJ, sem espera;
//   - 'random': chave aleatória (EVP); os saques ficam bloqueados por 48 h depois do cadastro (guarda de saque).
// Autorização assinada (kind 'set_pix_key'): o Alber Food só consegue cadastrar uma chave se a pessoa passou pelos controles dele.
//
// DESVIOS DO CONTRATO (registrados no relatório, aditivos):
//   - `cnpj` (obrigatório para key_type 'cnpj'): o Alber guarda só o hash do CNPJ, então precisa do CNPJ em claro para gravar a chave. É
//     conferido contra companies.cnpj (CNPJ_MISMATCH, 422), como no app.
//   - `pix_key` (opcional para key_type 'random'): EVP que o dono já tem no banco dele (a chave de saque é de qualquer banco, como no app). Sem
//     ela, o Alber registra uma EVP NOVA na subconta, como diz o contrato. Quando o corpo traz a chave (cnpj ou pix_key), a autorização TEM de
//     trazer destination_digest = SHA-256 de `${company_id}|${chave}`, amarrando a assinatura à chave que a pessoa confirmou.

import { handleCors, err } from '../_shared/cors.ts'
import { aesEncrypt } from '../_shared/crypto.ts'
import { createPixAddressKey } from '../_shared/asaas.ts'
import { decryptSubaccountKey } from '../_shared/subaccount-key.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { isValidEvpKey } from '../_shared/pix-key.ts'
import { logError } from '../_shared/error-log.ts'
import {
  adminClient, destinationDigest, isObject, isOperational, loadOwnedCompany, pixKeyView, readIds, readServiceBody, refusal, runFoodOp, sha256hex,
  type FoodCompany,
} from '../_shared/food-company.ts'

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const { body } = parsed
  const ids = readIds(body)
  if (!ids.ok) return ids.res
  const keyType = body.key_type
  if (keyType !== 'cnpj' && keyType !== 'random') return err('INVALID_KEY_TYPE', 'key_type deve ser cnpj ou random', 422)
  if (!isObject(body.op)) return err('MISSING_FIELDS', 'op é obrigatório', 400)

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
  if (!loaded.ok) return loaded.res
  const company: FoodCompany = loaded.company

  // A chave que o corpo traz (se trouxer), já validada. Sem ela (random sem pix_key), o Alber gera uma EVP nova.
  let material: string | null = null
  let cnpjHash: string | null = null
  if (keyType === 'cnpj') {
    const cnpjClean = normalizeCnpj(typeof body.cnpj === 'string' ? body.cnpj : '')
    if (!validateCnpj(cnpjClean)) return err('CNPJ_INVALID', 'CNPJ inválido', 422)
    cnpjHash = await sha256hex(cnpjClean)
    if (cnpjHash !== company.cnpj) return err('CNPJ_MISMATCH', 'Esse CNPJ não corresponde ao cadastrado para esta empresa', 422)
    material = cnpjClean
  } else if (body.pix_key != null) {
    const evp = typeof body.pix_key === 'string' ? body.pix_key.trim().toLowerCase() : ''
    if (!isValidEvpKey(evp)) return err('PIX_KEY_INVALID', 'Chave Pix aleatória inválida', 422)
    material = evp
  }

  return await runFoodOp(
    supabaseAdmin, 'food-company-set-pix-key', req, body.op,
    { kind: 'set_pix_key', companyId: company.id, ownerRef: ids.ownerRef, destinationDigest: material ? await destinationDigest(company.id, material) : null },
    async (op) => {
      // Estado da empresa conferido DEPOIS da autorização e da reserva: repetir uma operação já concluída devolve o desfecho original mesmo
      // que a empresa tenha mudado de estado (idempotência), e o erro de uma tentativa nova fica guardado junto com ela.
      if (!isOperational(company)) return refusal('COMPANY_NOT_APPROVED', 'Empresa sem conta aprovada', 409)
      if (company.pix_key) return refusal('PIX_KEY_EXISTS', 'Chave Pix já cadastrada', 409)

      const pixKeySecret = Deno.env.get('ENCRYPTION_KEY')!
      let key = material
      if (!key) {
        // Sem chave no corpo: registra uma EVP nova na subconta.
        try {
          key = (await createPixAddressKey('EVP', await decryptSubaccountKey(company.asaas_api_key_enc as string))).key
        } catch (e) {
          await logError(supabaseAdmin, 'food-company-set-pix-key', e, { company_id: company.id })
          return refusal('ASAAS_ERROR', 'Não foi possível registrar a chave Pix agora. Tente novamente.', 503, { retryable: true })
        }
      }

      const now = new Date().toISOString()
      const update: Record<string, unknown> = {
        pix_key: await aesEncrypt(key, pixKeySecret),
        pix_key_type: keyType,
        pix_key_hash: cnpjHash ?? await sha256hex(key),
        pix_key_set_at: now,
        updated_at: now,
      }
      // Só a chave aleatória espera 48 h (guarda de saque): a do CNPJ vai para a conta do próprio CNPJ.
      if (keyType === 'random') update.pix_key_changed_at = now

      // Condicional a "ainda sem chave": duas chamadas ao mesmo tempo gravam só uma.
      const { data: saved, error } = await supabaseAdmin.from('companies').update(update).eq('id', company.id).is('pix_key', null).select('id')
      if (error) {
        await logError(supabaseAdmin, 'food-company-set-pix-key', error, { company_id: company.id })
        return refusal('DB_ERROR', 'Erro ao salvar chave Pix', 500, { retryable: true })
      }
      if (!saved || saved.length === 0) return refusal('PIX_KEY_EXISTS', 'Chave Pix já cadastrada', 409)

      await supabaseAdmin.from('audit_logs').insert({
        user_id: null,
        event_type: 'company_pix_key_changed',
        metadata: { company_id: company.id, pix_key_type: keyType, via: 'food', owner_ref: op.owner_ref, generated: material === null },
      }).then(() => {}, () => {})

      const view = await pixKeyView({ ...company, pix_key: update.pix_key as string, pix_key_type: keyType, pix_key_set_at: now, pix_key_changed_at: keyType === 'random' ? now : company.pix_key_changed_at })
      return { ok: true, status: 200, body: { pix_key: view } }
    },
  )
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}

