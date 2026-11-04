// POST /food-company-owner-transfer   (Alber Food -> Alber; x-alber-food-key + autorização assinada; sem JWT de usuário)
//   { company_id, from_owner_ref, to_owner_ref, new_owner: { cpf, name, phone }, op, cnpj }
//   -> { owner_link_check, owner_link_review, pix_key_reset: true, withdraw_available_at }
//
// Troca o titular (dono) da empresa do Alber Food. Quem decide a troca (carência de 72 h, aceite, papéis) é o Alber Food; esta função é só o
// efeito no dinheiro: atualiza companies.owner_ref, refaz a conferência do vínculo para o NOVO dono (CPF x quadro societário do CNPJ; fora de
// 'match' vai para a revisão da equipe), ZERA a chave Pix de saque (único caminho que a limpa) e reinicia a espera de 48 h dos saques.
// Autorização assinada (kind 'owner_transfer', owner_ref = from_owner_ref, new_owner_ref = to_owner_ref). O CPF do novo dono vem do cadastro
// dele no Alber Food e não é guardado.
//
// DESVIO DO CONTRATO (aditivo, registrado no relatório): `cnpj` é obrigatório. O Alber guarda só o hash do CNPJ e a consulta ao quadro
// societário precisa do CNPJ em claro; é conferido contra companies.cnpj (CNPJ_MISMATCH, 422).
// Decisão pendente: os limites de saque aprovados e um pedido de aumento em aberto SEGUEM com a empresa depois da troca (o contrato não manda
// limpar). A equipe pode voltar aos limites padrão no Alber Admin.

import { handleCors, err } from '../_shared/cors.ts'
import { validateCnpj, normalizeCnpj } from '../_shared/cnpj.ts'
import { normalizeCpf, validateCpf } from '../_shared/cpf.ts'
import { evaluateOwnerCpf, fetchCnpjRegistry, reviewFor, type CnpjRegistry } from '../_shared/owner-link.ts'
import { WITHDRAW_RULES } from '../_shared/withdraw-guard.ts'
import { logError } from '../_shared/error-log.ts'
import {
  adminClient, isObject, loadOwnedCompany, OWNER_REF, pixKeyAvailableAt, readIds, readServiceBody, refusal, runFoodOp, sha256hex,
} from '../_shared/food-company.ts'

export interface OwnerTransferDeps {
  /** Consulta ao quadro societário do CNPJ (injetável nos testes). */
  registry?: (cnpj: string) => Promise<CnpjRegistry | null>
}

export async function handleRequest(req: Request, deps: OwnerTransferDeps = {}): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const { body } = parsed
  const ids = readIds(body, 'from_owner_ref')
  if (!ids.ok) return ids.res
  const toOwnerRef = typeof body.to_owner_ref === 'string' ? body.to_owner_ref : ''
  if (!OWNER_REF.test(toOwnerRef) || toOwnerRef === ids.ownerRef) return err('INVALID_OWNER', 'to_owner_ref inválido', 422)
  if (!isObject(body.new_owner)) return err('MISSING_FIELDS', 'new_owner é obrigatório', 400)
  if (!isObject(body.op)) return err('MISSING_FIELDS', 'op é obrigatório', 400)

  const cpf = normalizeCpf(typeof body.new_owner.cpf === 'string' ? body.new_owner.cpf : '')
  if (!validateCpf(cpf)) return err('CPF_INVALID', 'CPF inválido', 422)
  const name = typeof body.new_owner.name === 'string' ? body.new_owner.name.trim() : ''
  const phoneDigits = (typeof body.new_owner.phone === 'string' ? body.new_owner.phone : '').replace(/\D/g, '')
  if (name.length < 2 || name.length > 120 || !/^\d{10,11}$/.test(phoneDigits)) return err('INVALID_OWNER', 'new_owner inválido', 422)
  const cnpjClean = normalizeCnpj(typeof body.cnpj === 'string' ? body.cnpj : '')
  if (!validateCnpj(cnpjClean)) return err('CNPJ_INVALID', 'CNPJ inválido', 422)

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef, [toOwnerRef])
  if (!loaded.ok) return loaded.res
  const company = loaded.company
  if (await sha256hex(cnpjClean) !== company.cnpj) return err('CNPJ_MISMATCH', 'Esse CNPJ não corresponde ao cadastrado para esta empresa', 422)

  return await runFoodOp(
    supabaseAdmin, 'food-company-owner-transfer', req, body.op,
    { kind: 'owner_transfer', companyId: company.id, ownerRef: ids.ownerRef, newOwnerRef: toOwnerRef },
    async (op) => {
      // Conferência do vínculo do NOVO dono (o CPF é o do cadastro dele no Alber Food, sem prova por hash).
      const verdict = evaluateOwnerCpf(cpf, await (deps.registry ?? fetchCnpjRegistry)(cnpjClean))
      const review = reviewFor(verdict.check)
      const now = new Date()
      const nowIso = now.toISOString()

      // Condicional ao dono de antes: se o titular mudou nesse meio tempo, não aplica.
      const { data: saved, error } = await supabaseAdmin
        .from('companies')
        .update({
          owner_ref: toOwnerRef,
          owner_link_check: verdict.check,
          owner_link_review: review,
          owner_link_qualification: verdict.qualification,
          owner_link_checked_at: nowIso,
          owner_link_reviewed_at: null,
          // Chave de saque zerada e espera de 48 h reiniciada: pix_key_changed_at é o que a guarda de saque usa.
          pix_key: null,
          pix_key_type: null,
          pix_key_hash: null,
          pix_key_set_at: null,
          pix_key_changed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', company.id)
        .eq('owner_ref', op.owner_ref)
        .select('id')
      if (error) {
        await logError(supabaseAdmin, 'food-company-owner-transfer', error, { company_id: company.id })
        return refusal('DB_ERROR', 'Erro ao trocar o titular', 500, { retryable: true })
      }
      if (!saved || saved.length === 0) return refusal('NOT_OWNER', 'Esta empresa não pertence a este dono', 403)

      await supabaseAdmin.from('audit_logs').insert({
        user_id: null,
        event_type: 'company_owner_transferred',
        metadata: { company_id: company.id, from_owner_ref: op.owner_ref, to_owner_ref: toOwnerRef, owner_link_check: verdict.check, owner_link_review: review, wait_hours: WITHDRAW_RULES.pixKeyWaitHours },
      }).then(() => {}, () => {})

      return {
        ok: true,
        status: 200,
        body: {
          owner_link_check: verdict.check,
          owner_link_review: review,
          pix_key_reset: true,
          withdraw_available_at: pixKeyAvailableAt(nowIso),
        },
      }
    },
  )
}

if (import.meta.main) {
  Deno.serve((req) => handleRequest(req))
}

