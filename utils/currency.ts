export function maskBRL(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits || digits === '0') return ''
  const num = parseInt(digits) / 100
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function parseBRL(masked: string): number {
  const clean = masked.replace(/[^\d,]/g, '').replace(',', '.')
  return parseFloat(clean) || 0
}

export function maskAlbers(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits || digits === '0') return ''
  const num = parseInt(digits) / 100
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function parseAlbers(masked: string): number {
  const clean = masked.replace(/[^\d,]/g, '').replace(',', '.')
  return parseFloat(clean) || 0
}
