// Regra de "desistir do cadastro da empresa" (plano velvet-puzzling-sedgewick), comum a company-abandon (app, dono é um usuário) e
// food-company-abandon (Alber Food, dono é só um owner_ref). Quem chama já provou que o ator é o dono da empresa; aqui ficam só as
// recusas por estado e o que é gravado. Libera o CNPJ e o @ na hora (deleted_at, índices parciais da migration 044). Não mexe na subconta
// do Asaas (fica órfã, o mesmo trade-off da rejeição automática de KYC).

export interface AbandonableCompany {
  kyc_status: string
  deleted_at: string | null
}

export interface AbandonRefusal {
  code: 'ALREADY_ABANDONED' | 'COMPANY_ALREADY_APPROVED'
  message: string
  status: 409 | 422
}

/** Recusa por estado: já cancelada (409) ou já verificada (422). null = pode cancelar. */
export function abandonRefusal(company: AbandonableCompany): AbandonRefusal | null {
  if (company.deleted_at) return { code: 'ALREADY_ABANDONED', message: 'Este cadastro já foi cancelado', status: 409 }
  if (company.kyc_status === 'approved') {
    return { code: 'COMPANY_ALREADY_APPROVED', message: 'Uma empresa já verificada não pode ser cancelada por aqui', status: 422 }
  }
  return null
}

/** O que se grava na empresa ao cancelar o cadastro. */
export function abandonPatch(now: Date = new Date()): { deleted_at: string; deleted_reason: 'abandoned' } {
  return { deleted_at: now.toISOString(), deleted_reason: 'abandoned' }
}
