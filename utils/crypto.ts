// SHA-256 via Web Crypto API (disponível no Hermes/RN 0.71+)
// Usado para hash de PIN antes de enviar ao backend (spec 05_security.md seção 7)
export async function sha256Hex(input: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(input)
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    // Fallback de dev — nunca usar em produção
    return `dev_${input.split('').reduce((a, c) => a + c.charCodeAt(0), 0).toString(16)}`
  }
}

// Normaliza string para hash de resposta de segurança:
// lowercase + remove acentos (spec 05_security.md seção 10)
export function normalizeSecurityAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

// Mascara uma resposta para exibição (spec 05_security.md seção 3)
export function maskAnswer(answer: string): string {
  const n = answer.length
  if (n <= 4) {
    return answer[0] + '*'.repeat(Math.max(0, n - 2)) + answer[n - 1]
  }
  if (n <= 8) {
    return answer.slice(0, 2) + '*'.repeat(n - 4) + answer.slice(n - 2)
  }
  return answer.slice(0, 3) + '*'.repeat(n - 6) + answer.slice(n - 3)
}
