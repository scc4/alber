// Algoritmo oficial de validação de CPF brasileiro
export function validateCpf(raw: string): boolean {
  const d = raw.replace(/\D/g, '')
  if (d.length !== 11) return false
  // Rejeita sequências triviais (111.111.111-11 etc)
  if (/^(\d)\1{10}$/.test(d)) return false

  const calc = (n: number): number => {
    let sum = 0
    for (let i = 0; i < n - 1; i++) sum += parseInt(d[i]) * (n - i)
    const rem = (sum * 10) % 11
    return rem >= 10 ? 0 : rem
  }

  return calc(10) === parseInt(d[9]) && calc(11) === parseInt(d[10])
}

export function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, '')
}

// Versão mascarada pra exibição — formato definido em specs/05_security.md
// §7: esconde os 2 primeiros blocos + o primeiro dígito do 3º bloco, mostra
// o resto (2 dígitos do 3º bloco + verificadores). Só deve ser chamada com
// o CPF em texto puro antes dele ser hasheado — o resultado é o que fica
// persistido, nunca o CPF completo.
export function maskCpfForDisplay(raw: string): string {
  const d = normalizeCpf(raw)
  if (d.length !== 11) return '***.***.***-**'
  return `***.***.*${d.slice(7, 9)}-${d.slice(9)}`
}
