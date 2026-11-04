// POST /food-company-set-pix-key   (Alber Food -> Alber; x-alber-food-key + autorização assinada; sem JWT de usuário)
//   { company_id, owner_ref, key_type: 'cnpj'|'random', cnpj, pix_key?, op }
//   -> { pix_key: { configured: true, type, masked, digest, changed_at, available_at } }
//
// Cadastra a chave Pix de SAQUE da empresa (decisão de 04/11/2026: preferencialmente a do CNPJ; chave aleatória só com verificação de que
// pertence ao CNPJ da empresa). Regras de company-set-pix-key (app), mantidas:
//   - a chave só é gravada UMA vez (PIX_KEY_EXISTS, 409); o único caminho que a limpa é a troca de titular (food-company-owner-transfer);
//   - 'cnpj': o destino é a conta do próprio CNPJ, sem espera;
//   - 'random': chave aleatória (EVP) colada pelo dono; os saques ficam bloqueados por 48 h depois do cadastro (guarda de saque).
// Campos: `cnpj` é OBRIGATÓRIO nos dois tipos (o Alber guarda só o hash; conferido contra companies.cnpj: CNPJ_MISMATCH, 422).
// `pix_key` é OBRIGATÓRIO para 'random' (ausente: 400 MISSING_FIELDS) e PROIBIDO para 'cnpj' (400 INVALID_BODY). O Alber nunca gera chave nova
// na subconta (o saque voltaria para a própria subconta). A autorização assinada (kind 'set_pix_key') leva SEMPRE destination_digest =
// SHA-256 de `${company_id}|${chave}` (CNPJ normalizado em maiúsculas; EVP em minúsculas).
//
// VERIFICAÇÃO DA EVP (só 'random'), depois da autorização e da reserva: consulta do Asaas GET /pix/addressKeys/external?type=EVP&key=<evp>
// com a chave de API da SUBCONTA. FAIL-CLOSED: só aceita se owner.cpfCnpj, normalizado, tiver os 14 caracteres completos e for igual ao CNPJ do
// corpo. Chave não encontrada: 422 PIX_KEY_NOT_FOUND. Dono com outro documento: 422 PIX_KEY_OWNER_MISMATCH (mensagem genérica; só o
// audit_logs 'company_pix_key_rejected' guarda o motivo, nunca nome ou documento de terceiro). Documento mascarado/incompleto, rede, 5xx, 429
// ou resposta ilegível: 503 PIX_KEY_VERIFICATION_UNAVAILABLE (`retryable: true` só para rede/5xx/429; mascarado: `retryable: false`, use a chave
// do CNPJ). Nunca aceita sem verificação conclusiva. Em produção o comportamento do Asaas para CNPJ não está documentado (docs/perguntas-asaas.md).

import { handleCors, err } from '../_shared/cors.ts'
import { aesEncrypt } from '../_shared/crypto.ts'
import { lookupExternalPixKey, type ExternalPixKeyLookup } from '../_shared/asaas.ts'
import { decryptSubaccountKey } from '../_shared/subaccount-key.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { isValidEvpKey } from '../_shared/pix-key.ts'
import { logError } from '../_shared/error-log.ts'
import {
  adminClient, destinationDigest, isObject, isOperational, loadOwnedCompany, pixKeyView, readIds, readServiceBody, refusal, runFoodOp, sha256hex,
  type FoodCompany,
} from '../_shared/food-company.ts'

export interface SetPixKeyDeps {
  /** Consulta de chave Pix externa no Asaas (injetável nos testes). */
  lookupPixKey?: (evp: string, subaccountApiKey: string) => Promise<ExternalPixKeyLookup>
}

export async function handleRequest(req: Request, deps: SetPixKeyDeps = {}): Promise<Response> {
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
  if (keyType === 'random' && body.pix_key == null) return err('MISSING_FIELDS', 'pix_key é obrigatório para chave aleatória', 400)
  if (keyType === 'cnpj' && body.pix_key != null) return err('INVALID_BODY', 'pix_key não se aplica à chave do tipo cnpj', 400)

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
  if (!loaded.ok) return loaded.res
  const company: FoodCompany = loaded.company

  // `cnpj` nos dois tipos, conferido contra o hash da empresa.
  const cnpjClean = normalizeCnpj(typeof body.cnpj === 'string' ? body.cnpj : '')
  if (!validateCnpj(cnpjClean)) return err('CNPJ_INVALID', 'CNPJ inválido', 422)
  const cnpjHash = await sha256hex(cnpjClean)
  if (cnpjHash !== company.cnpj) return err('CNPJ_MISMATCH', 'Esse CNPJ não corresponde ao cadastrado para esta empresa', 422)

  let key = cnpjClean
  if (keyType === 'random') {
    const evp = typeof body.pix_key === 'string' ? body.pix_key.trim().toLowerCase() : ''
    if (!isValidEvpKey(evp)) return err('PIX_KEY_INVALID', 'Chave Pix aleatória inválida', 422)
    key = evp
  }

  return await runFoodOp(
    supabaseAdmin, 'food-company-set-pix-key', req, body.op,
    { kind: 'set_pix_key', companyId: company.id, ownerRef: ids.ownerRef, destinationDigest: await destinationDigest(company.id, key) },
    async (op) => {
      // Estado da empresa conferido DEPOIS da autorização e da reserva: repetir uma operação já concluída devolve o desfecho original mesmo
      // que a empresa tenha mudado de estado (idempotência), e o erro de uma tentativa nova fica guardado junto com ela.
      if (!isOperational(company)) return refusal('COMPANY_NOT_APPROVED', 'Empresa sem conta aprovada', 409)
      if (company.pix_key) return refusal('PIX_KEY_EXISTS', 'Chave Pix já cadastrada', 409)

      if (keyType === 'random') {
        const rejected = async (reason: string) => {
          await supabaseAdmin.from('audit_logs').insert({
            user_id: null, event_type: 'company_pix_key_rejected', metadata: { company_id: company.id, via: 'food', owner_ref: op.owner_ref, reason },
          }).then(() => {}, () => {})
        }
        let lookup: ExternalPixKeyLookup
        try {
          lookup = await (deps.lookupPixKey ?? lookupExternalPixKey)(key, await decryptSubaccountKey(company.asaas_api_key_enc as string))
        } catch (e) {
          await logError(supabaseAdmin, 'food-company-set-pix-key', e, { company_id: company.id })
          lookup = { kind: 'unavailable', retryable: true }
        }
        const unavailable = async (retryable: boolean, reason: string, message: string) => {
          await rejected(reason)
          return refusal('PIX_KEY_VERIFICATION_UNAVAILABLE', message, 503, { extra: { retryable }, retryable })
        }
        if (lookup.kind === 'unavailable') {
          return await unavailable(lookup.retryable, 'verification_unavailable', 'Não foi possível verificar a chave Pix agora. Tente novamente em instantes.')
        }
        if (lookup.kind === 'not_found') {
          await rejected('not_found')
          return refusal('PIX_KEY_NOT_FOUND', 'Chave Pix não encontrada', 422)
        }
        // Fail-closed: o documento tem de vir COMPLETO (14 caracteres) e igual ao CNPJ da empresa.
        const ownerDoc = normalizeCnpj(lookup.ownerDocument)
        if (ownerDoc.length !== 14) {
          return await unavailable(false, 'document_masked', 'Não foi possível confirmar o dono da chave Pix. Use a chave do CNPJ da empresa.')
        }
        if (ownerDoc !== cnpjClean) {
          await rejected('owner_mismatch')
          return refusal('PIX_KEY_OWNER_MISMATCH', 'Esta chave Pix não pertence ao CNPJ da empresa', 422)
        }
      }

      const now = new Date().toISOString()
      const update: Record<string, unknown> = {
        pix_key: await aesEncrypt(key, Deno.env.get('ENCRYPTION_KEY')!),
        pix_key_type: keyType,
        pix_key_hash: await sha256hex(key),
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
        metadata: { company_id: company.id, pix_key_type: keyType, via: 'food', owner_ref: op.owner_ref },
      }).then(() => {}, () => {})

      const view = await pixKeyView({ ...company, pix_key: update.pix_key as string, pix_key_type: keyType, pix_key_set_at: now, pix_key_changed_at: keyType === 'random' ? now : company.pix_key_changed_at })
      return { ok: true, status: 200, body: { pix_key: view } }
    },
  )
}

if (import.meta.main) {
  Deno.serve((req) => handleRequest(req))
}
