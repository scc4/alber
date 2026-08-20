// Espelha supabase/functions/_shared/pix-key.ts — chave Pix aleatória (EVP):
// UUID em minúsculas, gerada pelo banco do usuário/empresa, nunca escolhida.
const EVP_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidEvpKey(raw: string): boolean {
  return EVP_FORMAT.test(raw.trim())
}
