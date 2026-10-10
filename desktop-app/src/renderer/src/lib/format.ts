const NUM_WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve'
]

export const word = (n: number): string => NUM_WORDS[n] ?? String(n)

export const clock = (ts: number): string => {
  const d = new Date(ts)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 || 12}:${m < 10 ? '0' : ''}${m} ${h >= 12 ? 'pm' : 'am'}`
}

export const money = (n: number): string =>
  n === 0 ? '$0' : `$${(Math.round(n * 100) / 100).toFixed(n < 10 && n % 1 ? 2 : 0)}`

export const tiny = (n: number): string =>
  n === 0 ? '$0' : n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`

export function minutes(n: number): string {
  if (n < 60) return `${n} minute${n === 1 ? '' : 's'}`
  const h = Math.floor(n / 60)
  const m = n % 60
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} min` : ''}`
}

export function ago(ts: number | null): string {
  if (!ts) return 'never'
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 45) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 172800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  return `${s < 10 ? s.toFixed(2) : Math.round(s)}s`
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`

export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ')

export const initials = (s: string): string =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
