import * as ExpoCrypto from 'expo-crypto'

// SHA-256 via expo-crypto (nativo, confiável em Android/iOS com Hermes)
export async function sha256Hex(input: string): Promise<string> {
  return ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, input)
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
