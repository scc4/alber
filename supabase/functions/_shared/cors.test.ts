// Roda com: deno test supabase/functions/_shared/cors.test.ts --allow-env --allow-read
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

// O módulo lê ALBER_CORS_ORIGIN ao carregar: cada caso importa uma cópia nova (?v=n).
async function load(origin: string | undefined, v: number) {
  if (origin === undefined) Deno.env.delete('ALBER_CORS_ORIGIN'); else Deno.env.set('ALBER_CORS_ORIGIN', origin)
  try { return await import(`./cors.ts?v=${v}`) } finally { Deno.env.delete('ALBER_CORS_ORIGIN') }
}

Deno.test('CORS: sem ALBER_CORS_ORIGIN nenhuma origem é liberada (nem "*")', async () => {
  const m = await load(undefined, 1)
  assertEquals(m.corsHeaders['Access-Control-Allow-Origin'], undefined)
  assertEquals(m.json({ ok: true }).headers.get('Access-Control-Allow-Origin'), null)
  assertEquals(m.handleCors(new Request('http://x', { method: 'OPTIONS' }))?.headers.get('Access-Control-Allow-Origin'), null)
})

Deno.test('CORS: com ALBER_CORS_ORIGIN só aquela origem exata, com Vary: Origin', async () => {
  const m = await load('https://app.usealber.com.br', 2)
  assertEquals(m.corsHeaders['Access-Control-Allow-Origin'], 'https://app.usealber.com.br')
  assertEquals(m.json({}).headers.get('Vary'), 'Origin')
})

Deno.test('CORS: "*" configurado por engano é ignorado', async () => {
  const m = await load('*', 3)
  assertEquals(m.corsHeaders['Access-Control-Allow-Origin'], undefined)
})
