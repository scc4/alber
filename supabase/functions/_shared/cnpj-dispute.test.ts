// Regras da disputa de CNPJ (_shared/cnpj-dispute.ts). Roda com: deno test supabase/functions/_shared/cnpj-dispute.test.ts

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { decideTakeover, hasDocumentProgress, PENDING_EXPIRY_DAYS, type ContestedCompany } from './cnpj-dispute.ts'

const NOW = new Date('2026-11-10T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const co = (over: Partial<ContestedCompany> = {}): ContestedCompany => ({ id: 'c1', owner_id: 'squatter', kyc_status: 'pending', created_at: daysAgo(1), owner_link_check: 'mismatch', kyc_evidence: null, ...over })

Deno.test('pendente há mais de 14 dias sem documento enviado vence, para qualquer pretendente (inclusive o próprio dono)', () => {
  for (const claimant of ['squatter', 'outro']) {
    for (const check of ['match', 'unchecked', 'mismatch']) {
      assertEquals(decideTakeover(co({ created_at: daysAgo(PENDING_EXPIRY_DAYS + 1), owner_link_check: 'match' }), claimant, check, NOW), 'expired')
    }
  }
  assertEquals(decideTakeover(co({ created_at: daysAgo(PENDING_EXPIRY_DAYS - 1), owner_link_check: 'match' }), 'outro', 'unchecked', NOW), null)
})

Deno.test('documento enviado ou aprovado protege a empresa pendente (vencimento e prioridade)', () => {
  for (const status of ['PENDING', 'APPROVED']) {
    const c = co({ created_at: daysAgo(40), kyc_evidence: { groups: [{ status: 'NOT_SENT' }, { status }] } })
    assertEquals(decideTakeover(c, 'outro', 'match', NOW), null, status)
  }
  assertEquals(hasDocumentProgress({ groups: [{ status: 'NOT_SENT' }, { status: 'REJECTED' }] }), false)
  assertEquals(hasDocumentProgress(null), false)
  assertEquals(hasDocumentProgress({}), false)
})

Deno.test('vínculo verificado assume o CNPJ de empresa pendente cuja conferência falhou ou não existiu', () => {
  assertEquals(decideTakeover(co({ owner_link_check: 'mismatch' }), 'dono', 'match', NOW), 'superseded')
  assertEquals(decideTakeover(co({ owner_link_check: 'unchecked' }), 'dono', 'match', NOW), 'superseded')
})

Deno.test('não desbanca sócio sem poderes, consulta indisponível, CNPJ inativo nem quem também confere', () => {
  for (const check of ['partner', 'unavailable', 'inactive', 'match']) {
    assertEquals(decideTakeover(co({ owner_link_check: check }), 'dono', 'match', NOW), null, check)
  }
})

Deno.test('pretendente sem vínculo verificado nunca assume (só o vencimento ajuda)', () => {
  for (const claimantCheck of ['unchecked', 'mismatch', 'partner', 'unavailable', 'inactive']) {
    assertEquals(decideTakeover(co({ owner_link_check: 'mismatch' }), 'dono', claimantCheck, NOW), null, claimantCheck)
  }
})

Deno.test('o próprio dono com pendência recente não "assume" a si mesmo; empresa não pendente nunca é disputada', () => {
  assertEquals(decideTakeover(co({ owner_id: 'dono', owner_link_check: 'mismatch' }), 'dono', 'match', NOW), null)
  for (const kyc of ['approved', 'submitted', 'rejected']) {
    assertEquals(decideTakeover(co({ kyc_status: kyc, created_at: daysAgo(60) }), 'dono', 'match', NOW), null, kyc)
  }
})
