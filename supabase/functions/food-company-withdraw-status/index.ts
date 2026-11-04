// POST /food-company-withdraw-status   (Alber Food -> Alber; x-alber-food-key; sem JWT de usuário; verify_jwt padrão, como as takeaway-*)
//   { company_id, owner_ref, transaction_ids?: string[] (UUIDs), idempotency_keys?: string[] }   (ao menos um; no total, de 1 a 20)
//   -> 200 { items: [{ transaction_id|null, idempotency_key|null, status: 'processing'|'completed'|'failed', amount_cents, destination_masked|null,
//                      created_at, completed_at|null, failure_code|null }] }
//
// Acompanha os saques feitos por food-company-withdraw. Somente leitura, sem autorização assinada. Devolve só lançamentos de SAQUE desta
// empresa (type 'descarregar' com via 'food'): ids de outra empresa, de outro tipo ou inexistentes simplesmente não aparecem (nunca 403 que revele
// existência). Empresa de outro dono: 404 COMPANY_NOT_FOUND. O status vem do que o webhook TRANSFER_DONE/TRANSFER_FAILED do Asaas grava na
// transação ('pending' e 'processing' = processing; 'completed'; 'failed'). `failure_code` é genérico (TRANSFER_FAILED), nunca texto do Asaas.
// `completed_at` é a data da conclusão, lida do audit_logs que o webhook grava (descarregar_completed / descarregar_failed; transactions não tem
// updated_at); null enquanto não conclui.
//
// POR CHAVE DE IDEMPOTÊNCIA (`idempotency_keys`): o Alber Food chama o saque com idempotency_key = id do desafio da etapa extra. Se a resposta se perdeu
// (rede, tempo esgotado), ele não conhece o transaction_id; pergunta pela chave. O lançamento nasce ANTES do Pix, com a chave nos metadados, então:
//   - lançamento encontrado pela chave: o item de sempre (com transaction_id e idempotency_key);
//   - sem lançamento, operação `in_progress` (food_ops): status 'processing' com transaction_id nulo (o Alber ainda não terminou: o desfecho segue
//     desconhecido; a equipe reconcilia pelo Admin);
//   - sem lançamento, operação `failed` (recusa guardada, ou encerrada pela equipe como OPERATION_ABANDONED): status 'failed' com o código da recusa;
//   - chave desconhecida (a chamada nunca chegou): o item não aparece, e repetir o saque com a mesma chave é seguro.

import { handleCors, json, err } from '../_shared/cors.ts'
import { UUID } from '../_shared/food-service.ts'
import { adminClient, isObject, loadOwnedCompany, readIds, readServiceBody } from '../_shared/food-company.ts'

export const MAX_STATUS_IDS = 20
/** Mesmo formato que o verificador da autorização aceita para idempotency_key (food-op.ts). */
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,64}$/
const CODE = /^[A-Z0-9_]{2,60}$/

type Row = Record<string, unknown>

export async function handleRequest(req: Request): Promise<Response> {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return err('METHOD_NOT_ALLOWED', 'Use POST', 405)
  const parsed = await readServiceBody(req)
  if (!parsed.ok) return parsed.res
  const ids = readIds(parsed.body)
  if (!ids.ok) return ids.res

  const txIn = parsed.body.transaction_ids === undefined ? [] : parsed.body.transaction_ids
  const keyIn = parsed.body.idempotency_keys === undefined ? [] : parsed.body.idempotency_keys
  const total = (Array.isArray(txIn) ? txIn.length : 0) + (Array.isArray(keyIn) ? keyIn.length : 0)
  if (!Array.isArray(txIn) || !txIn.every((v) => typeof v === 'string' && UUID.test(v)) || total < 1 || total > MAX_STATUS_IDS) {
    return err('INVALID_TRANSACTION_IDS', `transaction_ids deve ter UUIDs e, com idempotency_keys, de 1 a ${MAX_STATUS_IDS} itens`, 422)
  }
  if (!Array.isArray(keyIn) || !keyIn.every((v) => typeof v === 'string' && IDEMPOTENCY_KEY.test(v))) {
    return err('INVALID_IDEMPOTENCY_KEYS', 'idempotency_keys deve ser uma lista de chaves válidas', 422)
  }
  const wantedTx = [...new Set((txIn as string[]).map((v) => v.toLowerCase()))]
  const wantedKeys = [...new Set(keyIn as string[])]

  const supabaseAdmin = adminClient()
  const loaded = await loadOwnedCompany(supabaseAdmin, ids.companyId, ids.ownerRef)
  if (!loaded.ok) return loaded.res.status === 403 ? err('COMPANY_NOT_FOUND', 'Empresa não encontrada', 404) : loaded.res
  const companyId = loaded.company.id

  const select = 'id, status, amount, created_at, metadata'
  const fetchTx = async (column: string, values: string[]): Promise<{ rows: Row[]; error: boolean }> => {
    if (values.length === 0) return { rows: [], error: false }
    const { data, error } = await supabaseAdmin.from('transactions').select(select).eq('company_id', companyId).eq('type', 'descarregar').in(column, values)
    return { rows: Array.isArray(data) ? (data as Row[]) : [], error: !!error }
  }
  const byId = await fetchTx('id', wantedTx)
  const byKey = await fetchTx('metadata->>idempotency_key', wantedKeys)
  if (byId.error || byKey.error) return err('DB_ERROR', 'Erro ao consultar os saques', 503)

  const viaFood = (t: Row) => isObject(t.metadata) && (t.metadata as Record<string, unknown>).via === 'food'
  const txRows = new Map<string, Row>()
  for (const t of [...byId.rows, ...byKey.rows]) if (viaFood(t)) txRows.set(t.id as string, t)
  const keyOf = (t: Row): string | null => {
    const k = isObject(t.metadata) ? (t.metadata as Record<string, unknown>).idempotency_key : null
    return typeof k === 'string' ? k : null
  }
  const keysWithTx = new Set([...txRows.values()].map(keyOf).filter((k): k is string => k !== null))

  const doneAt = new Map<string, string>()
  const finished = [...txRows.values()].filter((t) => t.status === 'completed' || t.status === 'failed')
  if (finished.length > 0) {
    const { data: audits } = await supabaseAdmin
      .from('audit_logs')
      .select('created_at, metadata')
      .in('event_type', ['descarregar_completed', 'descarregar_failed'])
      .in('metadata->>transaction_id', finished.map((t) => t.id as string))
    for (const a of Array.isArray(audits) ? audits : []) {
      const id = (a.metadata as Record<string, unknown> | null)?.transaction_id
      if (typeof id === 'string') doneAt.set(id, a.created_at as string)
    }
  }

  const txItem = (t: Row) => {
    const status = t.status === 'completed' ? 'completed' : t.status === 'failed' ? 'failed' : 'processing'
    const meta = t.metadata as Record<string, unknown>
    return {
      transaction_id: t.id as string,
      idempotency_key: keyOf(t),
      status,
      amount_cents: Math.round(Number(t.amount) * 100),
      destination_masked: typeof meta.destination_masked === 'string' ? meta.destination_masked : null,
      created_at: t.created_at as string,
      completed_at: status === 'processing' ? null : (doneAt.get(t.id as string) ?? null),
      failure_code: status === 'failed' ? 'TRANSFER_FAILED' : null,
    }
  }

  // Chaves sem lançamento: a operação assinada (food_ops) diz o que se sabe.
  const noTx = wantedKeys.filter((k) => !keysWithTx.has(k))
  const opItems = new Map<string, ReturnType<typeof txItem> | Record<string, unknown>>()
  if (noTx.length > 0) {
    const { data: ops, error: opsErr } = await supabaseAdmin
      .from('food_ops')
      .select('idempotency_key, kind, status, amount_cents, created_at, completed_at, result')
      .eq('company_id', companyId)
      .eq('kind', 'withdraw')
      .in('idempotency_key', noTx)
    if (opsErr) return err('DB_ERROR', 'Erro ao consultar os saques', 503)
    for (const o of Array.isArray(ops) ? (ops as Row[]) : []) {
      const key = o.idempotency_key as string
      const base = { transaction_id: null, idempotency_key: key, amount_cents: Number(o.amount_cents ?? 0), destination_masked: null, created_at: o.created_at as string }
      if (o.status === 'in_progress') {
        opItems.set(key, { ...base, status: 'processing', completed_at: null, failure_code: null })
      } else if (o.status === 'failed') {
        const raw = isObject(o.result) ? (o.result as Record<string, unknown>).code : null
        opItems.set(key, { ...base, status: 'failed', completed_at: (o.completed_at as string | null) ?? null, failure_code: typeof raw === 'string' && CODE.test(raw) ? raw : 'OPERATION_FAILED' })
      }
      // completed sem lançamento achado pela chave: não acontece (o lançamento nasce antes); omitido de propósito.
    }
  }

  const items: unknown[] = []
  const seen = new Set<string>()
  for (const id of wantedTx) {
    const t = txRows.get(id)
    if (t && !seen.has(id)) { seen.add(id); items.push(txItem(t)) }
  }
  for (const k of wantedKeys) {
    const t = [...txRows.values()].find((r) => keyOf(r) === k)
    if (t) { if (!seen.has(t.id as string)) { seen.add(t.id as string); items.push(txItem(t)) } } else if (opItems.has(k)) items.push(opItems.get(k))
  }
  return json({ items })
}

if (import.meta.main) {
  Deno.serve(handleRequest)
}
