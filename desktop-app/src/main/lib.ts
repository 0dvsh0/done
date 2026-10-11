export function clip(s: string, n: number): string {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function fold(s: string, n: number): string {
  const t = String(s ?? '').trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  const lastBreak = cut.lastIndexOf('\n')
  return `${(lastBreak > n * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`
}

export function indent(s: string): string {
  return String(s ?? '')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
}
