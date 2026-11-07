// POST /food-company-handle-check   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário)
//   { handle } -> { available: boolean }
//
// Disponibilidade do @ da empresa no Alber enquanto a pessoa digita o cadastro no Alber Food. Substitui o `auth-check-handle` para o Food:
// aquele é do mundo pessoa física (aberto ao público, com limite por IP e reservas) e o Food não deve depender dele
// (specs/09_responsabilidades_sistemas.md, regra 4). Aqui a chamada é de servidor para servidor, só com a chave de serviço.
//
// Regra de unicidade igual à do company-create / food-company-create: o @ não pode existir entre usuários (com ou sem "@" gravado)
// nem entre empresas ativas. Reservas de @ NÃO contam: o Alber Food não reserva mais @ no Alber (auth-reserve-handle foi removida) e
// quem decide no fim é o food-company-create (COMPANY_HANDLE_TAKEN). Só devolve o booleano. O limite por IP do visitante é do
// Alber Food (que recebe a digitação); aqui não há IP de usuário.

import { handleCors, json, err } from '../_shared/cors.ts'
import { isValidHandleFormat } from '../_shared/company.ts'
import { adminClient, readServiceBody } from '../_shared/food-company.ts'

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res

  const handle = (typeof parsed.body.handle === 'string' ? parsed.body.handle : '').toLowerCase().replace(/^@/, '')
  // O login só reconhece @ que começa por letra (ver auth-login), então o cadastro também exige.
  if (!isValidHandleFormat(handle) || !/^[a-z]/.test(handle)) return err('HANDLE_INVALID', '@handle inválido', 422)

  const supabaseAdmin = adminClient()
  // O @ de usuário já foi gravado com e sem "@" (perfil-update-handle grava com): olha as duas formas.
  const [users, companies] = await Promise.all([
    supabaseAdmin.from('users').select('id').in('handle', [handle, '@' + handle]).limit(1).maybeSingle(),
    supabaseAdmin.from('companies').select('id').eq('handle', handle).is('deleted_at', null).maybeSingle(),
  ])
  // Falha de leitura nunca vira "livre": o Alber Food trata o erro como "sem resposta" (checagem tolerante) e o food-company-create decide.
  if (users.error || companies.error) return err('DB_ERROR', 'Erro ao consultar', 503)

  return json({ available: !users.data && !companies.data })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
