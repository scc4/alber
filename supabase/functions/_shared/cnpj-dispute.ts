// Disputa de CNPJ (fase 5 do plano de conferência CNPJ x administrador, docs/plano-conferencia-cnpj-administrador.md no Alber Food).
//
// Problema: uma empresa PENDENTE segura o CNPJ (índice único de CNPJ ativo). Quem abre primeiro um CNPJ alheio impede o dono de verdade de
// abrir. Regras, só para empresa pendente (aprovada nunca é disputada aqui; aí é caso de suporte):
//   1. VENCIMENTO: pendente há mais de 14 dias SEM nenhum documento enviado ao Asaas perde o CNPJ, seja de quem for.
//   2. PRIORIDADE AO VÍNCULO VERIFICADO: quem chega com o vínculo conferido (`match`) assume o CNPJ de outra pessoa cuja conferência
//      claramente falhou (`mismatch`) ou nem existiu (`unchecked`), desde que essa outra empresa não tenha documento enviado.
//      Quem consta como sócio sem poderes (`partner`), teve consulta indisponível (`unavailable`) ou já enviou documentos NÃO é desbancado.
//
// Limite conhecido: o quadro societário é público e o `match` compara só os dígitos 4 a 9 do CPF, então um CPF fabricado pode produzir
// `match`. Por isso a regra 2 só vale contra empresa sem nenhum documento enviado, e a identidade real continua sendo o KYC do Asaas.

export const PENDING_EXPIRY_DAYS = 14
const DAY_MS = 86_400_000

export interface ContestedCompany {
  id: string
  owner_id: string
  kyc_status: string
  created_at: string
  owner_link_check: string
  kyc_evidence?: { groups?: Array<{ status?: string }> } | null
  asaas_account_id?: string | null
}

export type Takeover = 'expired' | 'superseded'

/** Algum grupo de documentos já foi enviado (em análise ou aprovado): o dono de verdade já está em andamento. */
export function hasDocumentProgress(evidence: ContestedCompany['kyc_evidence']): boolean {
  return (evidence?.groups ?? []).some((g) => g.status === 'PENDING' || g.status === 'APPROVED')
}

/**
 * Decide se uma empresa pendente que segura o CNPJ perde o CNPJ para quem está abrindo agora.
 * Devolve o motivo ('expired' | 'superseded') ou null (continua segurando: o novo recebe CNPJ_UNDER_REVIEW).
 */
export function decideTakeover(contested: ContestedCompany, claimantId: string, claimantCheck: string, now: Date): Takeover | null {
  if (contested.kyc_status !== 'pending') return null
  if (hasDocumentProgress(contested.kyc_evidence)) return null

  const ageMs = now.getTime() - new Date(contested.created_at).getTime()
  if (ageMs > PENDING_EXPIRY_DAYS * DAY_MS) return 'expired'

  if (contested.owner_id !== claimantId && claimantCheck === 'match' && (contested.owner_link_check === 'mismatch' || contested.owner_link_check === 'unchecked')) {
    return 'superseded'
  }
  return null
}

export const TAKEOVER_NOTICE: Record<Takeover, { title: string; body: string }> = {
  expired: {
    title: 'Cadastro da empresa cancelado',
    body: 'O cadastro da empresa ficou mais de 14 dias sem documentos enviados e foi cancelado. Você pode abrir de novo quando quiser.',
  },
  superseded: {
    title: 'Cadastro da empresa cancelado',
    body: 'Outro responsável com vínculo confirmado com este CNPJ assumiu o cadastro. Se isso for um engano, fale com o suporte.',
  },
}
