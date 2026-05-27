// Algoritmo oficial de validação de CPF brasileiro — espelha _shared/cpf.ts
export function validateCPF(raw: string): boolean {
  const d = raw.replace(/\D/g, '')
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false

  const calc = (n: number): number => {
    let sum = 0
    for (let i = 0; i < n - 1; i++) sum += parseInt(d[i]) * (n - i)
    const rem = (sum * 10) % 11
    return rem >= 10 ? 0 : rem
  }

  return calc(10) === parseInt(d[9]) && calc(11) === parseInt(d[10])
}
