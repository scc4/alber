// Mascaramento de texto sensível antes de sair do backend — usado hoje em
// duas situações: opções de pergunta de segurança (auth-question) e nomes
// de operadores no seletor de login por empresa (auth-company-lookup).
// Nunca revela o texto original; só o tamanho aproximado e as bordas.

export function maskText(text: string): string {
  const n = text.length
  if (n <= 4) return text[0] + '*'.repeat(Math.max(0, n - 2)) + text[n - 1]
  if (n <= 8) return text.slice(0, 2) + '*'.repeat(n - 4) + text.slice(-2)
  return text.slice(0, 3) + '*'.repeat(n - 6) + text.slice(-3)
}
