import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/* ==========================================================================
   Finding the keys.

   In production they arrive in the environment. While you are working on this
   they live in a `.env` beside the project, and after you install it they live
   in your app-data folder. Rather than make you pick one, the app looks in all
   three and uses the first one it finds — so `npm run dev` works and a
   packaged build works, with the same code path.
   ========================================================================== */

/**
 * The keys this app will read out of a `.env`.
 *
 * A name that is not on this list is silently ignored, so adding a key here is
 * what actually makes it configurable.
 */
const NAMES = [
  'NEATLOGS_API_KEY',
  'LLM_API_KEY',
  'GROQ_API_KEY',
  'DONE_MODEL',
  'DONE_CODE_MODEL',
  // Per-engine keys. Optional: an engine without its provider's key runs on
  // the local model and says so, rather than pretending the work was delegated.
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  // GitHub. Optional — public repositories are readable without it, and the
  // token only raises the rate limit and reaches private ones.
  'GITHUB_API_KEY',
  'GH_TOKEN',
  // Search. Optional, but real web search needs one of them: every free HTML
  // search endpoint gates scrapers now, so with neither of these the agent
  // falls back to Wikipedia.
  'BRAVE_SEARCH_API_KEY',
  'TAVILY_API_KEY'
] as const

export type KeyName = (typeof NAMES)[number]

let cached: Record<string, string> | null = null

function searchDirs(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const dirs = [
    process.env.DONE_ENV_FILE ? dirname(resolve(process.env.DONE_ENV_FILE)) : null,
    process.cwd(),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '..', '..'),
    process.resourcesPath ?? null,
    home ? join(home, '.done') : null
  ].filter(Boolean) as string[]

  const out: string[] = []
  for (const start of dirs) {
    let dir = resolve(start)
    for (let i = 0; i < 6 && !out.includes(dir); i++) {
      out.push(dir)
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return out
}

function load(): Record<string, string> {
  if (cached) return cached
  const found: Record<string, string> = {}

  for (const dir of searchDirs()) {
    const file = join(dir, '.env')
    if (!existsSync(file)) continue
    try {
      const raw = readFileSync(file, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
        if (!m) continue
        const name = m[1].toUpperCase()
        if (!(NAMES as readonly string[]).includes(name)) continue
        if (found[name]) continue
        found[name] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    } catch {
      /* unreadable file, keep looking */
    }
  }

  cached = found
  return found
}

/** The environment first, then any `.env` we can find. */
export function envKey(name: KeyName): string | null {
  const fromProcess = process.env[name]
  if (fromProcess?.trim()) return fromProcess.trim()
  return load()[name]?.trim() || null
}

/** Copies whatever we found into `process.env` for the libraries that read it. */
export function hydrateEnv(): void {
  for (const [name, value] of Object.entries(load())) {
    if (!process.env[name]) process.env[name] = value
  }
}
