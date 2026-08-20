// Chave Pix aleatória (EVP) — formato definido pelo BACEN: UUID em minúsculas,
// sempre gerada por um PSP (banco/instituição de pagamento), nunca escolhida
// pelo usuário. Aqui a pessoa cola uma EVP já existente do próprio banco dela.
const EVP_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidEvpKey(raw: string): boolean {
  return EVP_FORMAT.test(raw.trim())
}
