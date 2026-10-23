/** Valor em Albers: duas casas, vírgula decimal, ponto de milhar. Sem símbolo de moeda. */
export function formatAlbers(value: number): string {
  const [int, dec] = Math.abs(value).toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${value < 0 ? '-' : ''}${grouped},${dec}`
}
