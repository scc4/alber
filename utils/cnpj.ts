// Algoritmo oficial de validação de CNPJ brasileiro — espelha _shared/cnpj.ts
// Suporta o CNPJ alfanumérico (emissão iniciada em 31/07/2026): as 12
// primeiras posições podem ser dígito (0-9) ou letra maiúscula (A-Z); os 2
// dígitos verificadores continuam sempre numéricos.

export function normalizeCNPJ(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}

function cnpjCharValue(c: string): number {
  return c.charCodeAt(0) - 48
}

export function validateCNPJ(raw: string): boolean {
  const d = normalizeCNPJ(raw)
  if (d.length !== 14) return false

  if (!/^\d{2}$/.test(d.slice(12))) return false
  if (!/^[0-9A-Z]{12}$/.test(d.slice(0, 12))) return false
  if (/^(.)\1{13}$/.test(d)) return false

  const calc = (len: number): number => {
    const weights = len === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let sum = 0
    for (let i = 0; i < len; i++) sum += cnpjCharValue(d[i]) * weights[i]
    const rem = sum % 11
    return rem < 2 ? 0 : 11 - rem
  }

  return calc(12) === cnpjCharValue(d[12]) && calc(13) === cnpjCharValue(d[13])
}
