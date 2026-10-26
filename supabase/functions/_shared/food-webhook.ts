// Repasse dos eventos de pagamento de pedidos do Alber Food. O Asaas avisa o Alber (webhooks-asaas-pix); quando a
// referência começa com 'food_' o evento NÃO é do Alber: segue para o Alber Food, assinado.
//   POST FOOD_WEBHOOK_URL   x-alber-timestamp: <segundos>   x-alber-signature: hex(HMAC-SHA256(segredo, "<ts>.<corpo>"))
// Corpo: { id, event, payment_id, external_reference, amount_cents, gateway_cost_cents } (valores em centavos).

export interface AsaasPaymentEvent {
  id?: string
  event: string
  payment?: { id: string; value?: number; netValue?: number; externalReference?: string }
}

export const isFoodReference = (ref: string | undefined): boolean => typeof ref === 'string' && ref.startsWith('food_')

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function signFoodEvent(secret: string, timestamp: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`)))
}

/** Normaliza o evento do Asaas para o contrato do Alber Food (centavos inteiros). */
export function foodEventBody(e: AsaasPaymentEvent): string {
  const p = e.payment!
  const cents = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null)
  const value = cents(p.value)
  const net = cents(p.netValue)
  return JSON.stringify({
    id: e.id ?? `${e.event}:${p.id}`,
    event: e.event,
    payment_id: p.id,
    external_reference: p.externalReference,
    amount_cents: value,
    gateway_cost_cents: value !== null && net !== null && value >= net ? value - net : null,
  })
}

/** 200 = o Alber Food recebeu (o Asaas pode parar de reenviar); 502 = falhou, o Asaas reenvia. */
export async function forwardToFood(e: AsaasPaymentEvent): Promise<Response> {
  const url = Deno.env.get('FOOD_WEBHOOK_URL')
  const secret = Deno.env.get('FOOD_WEBHOOK_SECRET')
  if (!url || !secret) {
    console.error('Webhook food_: FOOD_WEBHOOK_URL/FOOD_WEBHOOK_SECRET não configurados')
    return new Response('Service Unavailable', { status: 503 })
  }
  const raw = foodEventBody(e)
  const ts = String(Math.floor(Date.now() / 1000))
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-alber-timestamp': ts, 'x-alber-signature': await signFoodEvent(secret, ts, raw) },
      body: raw,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    // 4xx do Alber Food (assinatura recusada, corpo inválido) não melhora ao repetir: não trava a fila do Asaas.
    if (res.ok || (res.status >= 400 && res.status < 500)) {
      if (!res.ok) console.error('Webhook food_: recusado', res.status)
      return new Response('OK', { status: 200 })
    }
    return new Response('Bad Gateway', { status: 502 })
  } catch {
    return new Response('Bad Gateway', { status: 502 })
  }
}
