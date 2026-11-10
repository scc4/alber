// Conferência do vínculo do responsável com a empresa: o CPF que a pessoa digitou x o quadro societário público do CNPJ.
//
// Vive no Alber, no ponto único em que a subconta é criada (company.ts), para valer em qualquer canal (app, Alber Food, cadastro
// junto). O resultado é gravado na empresa (companies.owner_link_*) e, se não for `match`, manda a empresa para revisão da equipe.
//
// COMO COMPARA: os dígitos 4 a 9 do CPF digitado com o CPF mascarado de cada sócio (`***DDDDDD**`, como a Receita publica). Seis
// dígitos dão ~1 chance em 1 milhão de coincidir por acaso. O nome não entra: é texto digitado e daria falso "não confere"
// (abreviação, nome de casada). MEI e empresário individual: o CPF inteiro aparece na razão social e é comparado por igualdade.
//
// O QUE NÃO GARANTE: o quadro societário é público, então quem o lê pode fabricar um CPF válido com os mesmos dígitos 4 a 9. Esta
// conferência detecta erro e uso casual; quem prova a identidade é o KYC (documento e selfie) e, no caso de quem já tem conta
// Alber, o CPF confirmado pelo hash da conta (verifyOwnerCpfHash). Ver docs/plano-conferencia-cnpj-administrador.md (Alber Food).

import { cpfHash } from './crypto.ts'
import { normalizeCpf, validateCpf } from './cpf.ts'

export type OwnerLinkCheck = 'match' | 'partner' | 'mismatch' | 'inactive' | 'unavailable'

export interface RegistryPartner {
  name: string
  /** CPF mascarado como a Receita publica: `***DDDDDD**`. */
  cpfMask: string
  /** Qualificação na sociedade, como a Receita informa (ex.: "Sócio-Administrador"). */
  role: string
}

export interface CnpjRegistry {
  /** ATIVA, BAIXADA, INAPTA... */
  situation: string
  legalName: string
  partners: RegistryPartner[]
}

export interface OwnerLinkVerdict {
  check: OwnerLinkCheck
  /** Qualificação do sócio encontrado (só o cargo, nunca nome nem CPF). */
  qualification: string | null
}

/** Consulta pública ao cadastro do CNPJ (BrasilAPI). Falha, lentidão ou resposta estranha = null; nunca lança. */
export async function fetchCnpjRegistry(cnpj: string, fetchImpl: typeof fetch = fetch, timeoutMs = 4000): Promise<CnpjRegistry | null> {
  try {
    const res = await fetchImpl(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const d = (await res.json()) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const situation = str(d.descricao_situacao_cadastral).toUpperCase()
    if (!situation) return null
    const qsa = Array.isArray(d.qsa) ? (d.qsa as Record<string, unknown>[]) : []
    return {
      situation,
      legalName: str(d.razao_social),
      partners: qsa.map((q) => ({ name: str(q.nome_socio), cpfMask: str(q.cnpj_cpf_do_socio), role: str(q.qualificacao_socio) })).filter((p) => p.name),
    }
  } catch {
    return null
  }
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Qualificação com poderes de administração (códigos da Receita): Administrador, Sócio-Administrador, Sócio-Gerente, Diretor,
 * Presidente, Sócio Ostensivo e Titular (empresário individual, inclusive MEI). "Sócio" sozinho, "Conselheiro de Administração" e
 * "Procurador" não entram: vão para revisão (o Asaas tem o documento de procuração para esses casos).
 */
export function isAdminQualification(role: string): boolean {
  return /\b(administrador|gerente|diretor|presidente|ostensivo|titular)\b/.test(strip(role))
}

/** Dígitos 4 a 9 do CPF a partir da máscara da Receita `***DDDDDD**`; formato diferente (pessoa jurídica, estrangeiro) = null. */
function partnerMid6(mask: string): string | null {
  const m = /^\*{3}(\d{6})\*{2}$/.exec(mask.trim())
  return m ? (m[1] as string) : null
}

export function evaluateOwnerCpf(cpf: string, registry: CnpjRegistry | null): OwnerLinkVerdict {
  if (!registry || !/^\d{11}$/.test(cpf)) return { check: 'unavailable', qualification: null }
  if (registry.situation !== 'ATIVA') return { check: 'inactive', qualification: null }

  const mid = cpf.slice(3, 9)
  const found = registry.partners.filter((p) => partnerMid6(p.cpfMask) === mid)
  const admin = found.find((p) => isAdminQualification(p.role))
  if (admin) return { check: 'match', qualification: admin.role }
  if (found[0]) return { check: 'partner', qualification: found[0].role }

  const mei = /^(.*\D)\s(\d{11})$/.exec(registry.legalName.trim())
  if (mei) return mei[2] === cpf ? { check: 'match', qualification: 'Titular (MEI/empresário individual)' } : { check: 'mismatch', qualification: null }

  return { check: registry.partners.length === 0 ? 'unavailable' : 'mismatch', qualification: null }
}

/** `match` libera sozinho; qualquer outro resultado (inclusive consulta indisponível) manda para a revisão da equipe. */
export const reviewFor = (check: OwnerLinkCheck | 'unchecked'): 'not_needed' | 'pending' => (check === 'match' ? 'not_needed' : 'pending')

export type CpfProof = { ok: true; cpf: string } | { ok: false; code: 'CPF_INVALID' | 'OWNER_CPF_MISMATCH' }

/**
 * O CPF digitado é o da conta de quem está logado? Compara o hash (users.cpf guarda só o HMAC com pepper do CPF). Sem isto, bastaria digitar o CPF de
 * um sócio para "casar" com o quadro societário: o CPF tem de ser o da conta, que o dono provou com PIN e pergunta de segurança.
 */
export async function verifyOwnerCpfHash(rawCpf: unknown, accountCpfHash: string | null | undefined): Promise<CpfProof> {
  const cpf = normalizeCpf(typeof rawCpf === 'string' ? rawCpf : '')
  if (!validateCpf(cpf)) return { ok: false, code: 'CPF_INVALID' }
  if (!accountCpfHash || (await cpfHash(cpf)) !== accountCpfHash) return { ok: false, code: 'OWNER_CPF_MISMATCH' }
  return { ok: true, cpf }
}
