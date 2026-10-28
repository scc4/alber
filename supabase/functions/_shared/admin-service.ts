// Autenticação das funções que só o Alber Admin chama (leitura da conta pai): cabeçalho x-alber-admin-key igual ao segredo
// ALBER_ADMIN_SERVICE_KEY, comparado em tempo constante. Sem o segredo configurado, recusa tudo (503).
// Chave própria: o segredo do Alber Food (x-alber-food-key) NÃO vale aqui, e vice-versa.

import { err } from './cors.ts'

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

/** null = autorizado; senão, a resposta de erro a devolver. */
export function requireAdminKey(req: Request): Response | null {
  const secret = Deno.env.get('ALBER_ADMIN_SERVICE_KEY')
  if (!secret || secret.length < 32) return err('SERVICE_NOT_CONFIGURED', 'Serviço indisponível', 503)
  if (!safeEqual(req.headers.get('x-alber-admin-key') ?? '', secret)) return err('UNAUTHORIZED', 'Não autorizado', 401)
  return null
}
