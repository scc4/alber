// Algoritmo oficial de validação de CNPJ brasileiro — suporta o CNPJ
// alfanumérico (Instrução Normativa RFB nº 2.229/2024, emissão iniciada em
// 31/07/2026): as 12 primeiras posições podem ser dígito (0-9) ou letra
// maiúscula (A-Z); os 2 dígitos verificadores continuam sempre numéricos.
// Cálculo: mesmo módulo 11 e pesos de sempre — a única mudança é que cada
// caractere vira `código ASCII − 48` em vez de `parseInt` (dígito continua
// valendo 0-9; letra A-Z passa a valer 17-42). Retrocompatível: um CNPJ
// 100% numérico calcula exatamente igual a antes.

export function normalizeCnpj(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}

// Versão mascarada pra exibição — esconde as 8 primeiras posições (raiz, que
// identifica a empresa), mostra filial + dígitos verificadores. Só deve ser
// chamada com o CNPJ em texto puro antes dele ser hasheado (ver
// createCompanyForOwner) — o resultado é o que fica persistido, nunca o CNPJ
// completo.
export function maskCnpjForDisplay(raw: string): string {
  const d = normalizeCnpj(raw)
  if (d.length !== 14) return '**.***.***/****-**'
  return `**.***.***/${d.slice(8, 12)}-${d.slice(12)}`
}

function cnpjCharValue(c: string): number {
  return c.charCodeAt(0) - 48
}

export function validateCnpj(raw: string): boolean {
  const d = normalizeCnpj(raw)
  if (d.length !== 14) return false

  // Dígitos verificadores (posições 13-14) são sempre numéricos
  if (!/^\d{2}$/.test(d.slice(12))) return false
  // As 12 primeiras posições só aceitam dígito ou letra maiúscula
  if (!/^[0-9A-Z]{12}$/.test(d.slice(0, 12))) return false
  // Rejeita sequências triviais (qualquer caractere repetido 14x)
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
