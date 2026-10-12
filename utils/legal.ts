// Prova de aceite dos documentos legais (contrato BaaS Asaas cl. 8.2.4).
// A versão vem da linha "Última atualização: DD/MM/AAAA" do próprio texto
// exibido ao usuário, então não existe constante para esquecer de atualizar:
// mudou o texto, mudou o hash (e a versão, se a data foi atualizada).

import { sha256Hex } from './crypto'

export type ConsentType = 'terms_of_use' | 'privacy_policy' | 'majority'

export interface ConsentProof {
  type:      ConsentType
  version:   string   // YYYY-MM-DD, ou 'unknown' se o texto não traz data
  text_hash: string   // SHA-256 hex do texto exatamente como exibido
}

const UPDATED_AT = /Última atualização:\s*(\d{2})\/(\d{2})\/(\d{4})/

export function legalDocVersion(body: string): string {
  const m = UPDATED_AT.exec(body)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : 'unknown'
}

export async function buildConsentProof(
  type: ConsentType,
  body: string,
  versionSource: string = body,
): Promise<ConsentProof> {
  return {
    type,
    version:   legalDocVersion(versionSource),
    text_hash: await sha256Hex(body),
  }
}
