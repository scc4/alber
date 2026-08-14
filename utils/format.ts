export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value)
}

export function formatAlbers(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

export function formatDateGroup(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  if (sameDay(d, today)) return 'Hoje'
  if (sameDay(d, yesterday)) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function maskDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return digits
}

export function maskTime(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length > 2) return `${digits.slice(0, 2)}:${digits.slice(2)}`
  return digits
}

// Máscara de exibição do CNPJ — aceita dígito ou letra maiúscula nas 12
// primeiras posições (CNPJ alfanumérico, emissão iniciada em 31/07/2026);
// os 2 dígitos verificadores continuam sempre numéricos, mas a máscara não
// precisa validar isso, só formatar o que foi digitado até agora.
export function maskCNPJ(value: string): string {
  const chars = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 14)
  if (chars.length > 12) return `${chars.slice(0, 2)}.${chars.slice(2, 5)}.${chars.slice(5, 8)}/${chars.slice(8, 12)}-${chars.slice(12)}`
  if (chars.length > 8)  return `${chars.slice(0, 2)}.${chars.slice(2, 5)}.${chars.slice(5, 8)}/${chars.slice(8)}`
  if (chars.length > 5)  return `${chars.slice(0, 2)}.${chars.slice(2, 5)}.${chars.slice(5)}`
  if (chars.length > 2)  return `${chars.slice(0, 2)}.${chars.slice(2)}`
  return chars
}
