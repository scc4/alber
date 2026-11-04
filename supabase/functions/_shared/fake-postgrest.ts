// Banco falso em memória para os testes das funções food-company-* (NÃO é código de produção; só os testes importam).
// Instala-se no lugar de globalThis.fetch e responde ao subconjunto do PostgREST que o supabase-js usa nessas funções: filtros eq/neq/is/in/
// gt/gte/lt/lte, order, limit, select simples (projeta só as colunas pedidas: um campo esquecido no select aparece nos testes), insert/update/delete
// com `Prefer: return=representation`, `Accept: application/vnd.pgrst.object+json` (single/maybeSingle), HEAD com contagem, unicidade e CHECKs
// que espelham as constraints da migration 058. Chamadas que não são ao banco (Asaas, push) vão para o `other` do teste.

export type Row = Record<string, unknown>

export interface UniqueRule {
  cols: string[]
  /** Índice parcial: só vale para linhas em que isto é verdadeiro. */
  where?: (row: Row) => boolean
}

export interface RequestRecord {
  method: string
  table: string
  query: URLSearchParams
  body: unknown
}

type Other = (url: string, init: RequestInit | undefined, method: string) => Response | Promise<Response> | null | undefined

export class FakeDb {
  tables: Record<string, Row[]> = {}
  unique: Record<string, UniqueRule[]> = {}
  /** Regras estilo CHECK: devolvem uma mensagem se a linha viola. Rodam em insert e update. */
  checks: Record<string, (row: Row) => string | null> = {}
  /** Colunas NOT NULL por tabela (alem das de `checks`). */
  notNull: Record<string, string[]> = {}
  defaults: Record<string, () => Row> = {}
  log: RequestRecord[] = []
  /** Força um erro 500 para (método, tabela). */
  failOn: Array<{ method: string; table: string }> = []

  constructor(init: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(init)) this.tables[t] = rows.map((r) => ({ ...r }))
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }

  /** Registros do log para (método, tabela). */
  calls(method: string, table: string): RequestRecord[] {
    return this.log.filter((r) => r.method === method && r.table === table)
  }

  private jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  }

  private matches(row: Row, params: URLSearchParams): boolean {
    for (const [key, raw] of params.entries()) {
      if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue
      const dot = raw.indexOf('.')
      const op = raw.slice(0, dot)
      const val = raw.slice(dot + 1)
      const cell = this.cell(row, key)
      switch (op) {
        case 'eq': if (cell === null || cell === undefined || !this.same(cell, val)) return false; break
        case 'neq': if (cell !== null && cell !== undefined && this.same(cell, val)) return false; break
        case 'is': {
          const want = val === 'null' ? null : val === 'true' ? true : val === 'false' ? false : val
          const isNull = cell === null || cell === undefined
          if (want === null ? !isNull : isNull || cell !== want) return false
          break
        }
        case 'in': {
          const list = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))
          if (cell === null || cell === undefined || !list.some((v) => this.same(cell, v))) return false
          break
        }
        case 'gt': case 'gte': case 'lt': case 'lte': {
          if (cell === null || cell === undefined) return false
          const c = this.compare(cell, val)
          if (op === 'gt' && !(c > 0)) return false
          if (op === 'gte' && !(c >= 0)) return false
          if (op === 'lt' && !(c < 0)) return false
          if (op === 'lte' && !(c <= 0)) return false
          break
        }
        default: throw new Error(`FakeDb: operador não suportado "${op}" em ${key}=${raw}`)
      }
    }
    return true
  }

  private cell(row: Row, key: string): unknown {
    if (key.includes('->>')) {
      const [col, path] = key.split('->>') as [string, string]
      const j = row[col] as Row | null | undefined
      return j && typeof j === 'object' ? (j[path] ?? null) : null
    }
    return row[key]
  }

  private same(cell: unknown, val: string): boolean {
    return String(cell).toLowerCase() === val.toLowerCase()
  }

  private compare(cell: unknown, val: string): number {
    const a = typeof cell === 'number' ? cell : Number.isNaN(Number(cell)) ? Date.parse(String(cell)) : Number(cell)
    const b = Number.isNaN(Number(val)) ? Date.parse(val) : Number(val)
    return a - b
  }

  private project(rows: Row[], select: string | null): Row[] {
    if (!select || select.includes('(') || select.includes('*')) return rows.map((r) => ({ ...r }))
    const cols = select.split(',').map((c) => c.trim()).filter(Boolean)
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))
  }

  private violates(table: string, row: Row, others: Row[]): Response | null {
    for (const col of this.notNull[table] ?? []) {
      if (row[col] === null || row[col] === undefined) return this.jsonRes({ code: '23502', message: `null value in column "${col}" of relation "${table}" violates not-null constraint` }, 400)
    }
    const msg = this.checks[table]?.(row)
    if (msg) return this.jsonRes({ code: '23514', message: msg }, 400)
    for (const rule of this.unique[table] ?? []) {
      if (rule.where && !rule.where(row)) continue
      if (rule.cols.some((c) => row[c] === null || row[c] === undefined)) continue
      const dup = others.some((o) => o !== row && (!rule.where || rule.where(o)) && rule.cols.every((c) => String(o[c]) === String(row[c])))
      if (dup) return this.jsonRes({ code: '23505', message: `duplicate key value violates unique constraint on ${table} (${rule.cols.join(',')})` }, 409)
    }
    return null
  }

  /** Responde a uma chamada ao PostgREST ou devolve null se a URL não for do banco falso. */
  handle(url: string, init?: RequestInit): Response | null {
    const u = new URL(url)
    const m = /\/rest\/v1\/([^/?]+)$/.exec(u.pathname)
    if (!m) return null
    const table = m[1] as string
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    const wantsObject = (headers.get('accept') ?? '').includes('application/vnd.pgrst.object+json')
    const wantsRows = (headers.get('prefer') ?? '').includes('return=representation')
    const body = init?.body ? JSON.parse(String(init.body)) : null
    this.log.push({ method, table, query: u.searchParams, body })

    if (this.failOn.some((f) => f.method === method && f.table === table)) return this.jsonRes({ code: 'XX000', message: 'falha forçada pelo teste' }, 500)

    const all = this.rows(table)
    const select = u.searchParams.get('select')

    const respondRows = (rows: Row[], status: number): Response => {
      if (!wantsObject) return this.jsonRes(rows, status)
      if (rows.length !== 1) return this.jsonRes({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` }, 406)
      return this.jsonRes(rows[0], status)
    }

    if (method === 'GET' || method === 'HEAD') {
      let found = all.filter((r) => this.matches(r, u.searchParams))
      const order = u.searchParams.get('order')
      if (order) {
        const [col, dir] = order.split('.') as [string, string]
        found = [...found].sort((a, b) => {
          const c = this.compare(a[col] ?? 0, String(b[col] ?? 0))
          return dir === 'desc' ? -c : c
        })
      }
      const limit = u.searchParams.get('limit')
      if (limit) found = found.slice(0, Number(limit))
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-${Math.max(found.length - 1, 0)}/${found.length}` } })
      return respondRows(this.project(found, select), 200)
    }

    if (method === 'POST') {
      const incoming = (Array.isArray(body) ? body : [body]) as Row[]
      const created: Row[] = []
      for (const b of incoming) {
        const row: Row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(this.defaults[table]?.() ?? {}), ...b }
        const bad = this.violates(table, row, all)
        if (bad) return bad
        all.push(row)
        created.push(row)
      }
      if (!wantsRows) return new Response(null, { status: 201 })
      return respondRows(this.project(created, select), 201)
    }

    if (method === 'PATCH') {
      const found = all.filter((r) => this.matches(r, u.searchParams))
      for (const r of found) {
        const next = { ...r, ...(body as Row) }
        const bad = this.violates(table, next, all.filter((o) => o !== r))
        if (bad) return bad
      }
      for (const r of found) Object.assign(r, body as Row)
      if (!wantsRows) return new Response(null, { status: 204 })
      return respondRows(this.project(found, select), 200)
    }

    if (method === 'DELETE') {
      const found = all.filter((r) => this.matches(r, u.searchParams))
      this.tables[table] = all.filter((r) => !found.includes(r))
      if (!wantsRows) return new Response(null, { status: 204 })
      return respondRows(this.project(found, select), 200)
    }

    throw new Error(`FakeDb: método não suportado ${method}`)
  }
}

/** Troca globalThis.fetch pelo banco falso (e por `other` para o resto). Devolve a função que restaura. */
export function installFakeFetch(db: FakeDb, other: Other = () => null): () => void {
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const reqInit = init ?? (input instanceof Request ? { method: input.method, headers: input.headers } : undefined)
    const method = (reqInit?.method ?? 'GET').toUpperCase()
    const hit = db.handle(url, reqInit)
    if (hit) return hit
    const o = await other(url, reqInit, method)
    if (o) return o
    return new Response(JSON.stringify({ error: `Unmocked ${method} ${url}` }), { status: 500 })
  }) as typeof fetch
  return () => { globalThis.fetch = orig }
}
