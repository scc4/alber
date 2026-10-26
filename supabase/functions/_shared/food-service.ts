// Autenticação das funções que só o Alber Food chama (cobranças de take away): cabeçalho x-alber-food-key igual ao
// segredo ALBER_FOOD_SERVICE_KEY, comparado em tempo constante. Sem o segredo configurado, recusa tudo (503).

import { err } from './cors.ts'

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

/** null = autorizado; senão, a resposta de erro a devolver. */
export function requireFoodKey(req: Request): Response | null {
  const secret = Deno.env.get('ALBER_FOOD_SERVICE_KEY')
  if (!secret || secret.length < 32) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  if (!safeEqual(req.headers.get('x-alber-food-key') ?? '', secret)) return err('UNAUTHORIZED', 'Não autorizado', 401)
  return null
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Referência enviada ao Asaas: 'food_' + id do pagamento no Alber Food. */
export const FOOD_REFERENCE = /^food_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ASAAS_PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/

export const toReais = (cents: number): number => Math.round(cents) / 100
