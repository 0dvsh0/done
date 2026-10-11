import { constants } from 'node:fs'
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { defineTool } from './types'

/* ==========================================================================
   Files — real reads and real writes, inside a box.

   The agent can genuinely touch the disk. That makes the sandbox load-bearing
   rather than decorative: paths are resolved and checked against a list of
   roots the user actually works in, and anything outside is refused by name
   so the refusal shows up in the trace instead of failing somewhere deeper.
   ========================================================================== */

const HOME = resolve(homedir())

/** Where the agent is allowed to work. Anything outside is refused. */
const ROOTS: string[] = [
  HOME,
  resolve(process.cwd()),
  resolve(tmpdir()),
  join(HOME, 'Desktop'),
  join(HOME, 'Documents'),
  join(HOME, 'Downloads')
]

/** Never, regardless of where they are rooted. */
const FORBIDDEN = [
  join(sep, 'Windows'),
  join(sep, 'Program Files'),
  join(sep, 'Program Files (x86)'),
  join(sep, 'ProgramData'),
  join(sep, 'etc'),
  join(sep, 'usr', 'bin'),
  join(sep, 'System32'),
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)'
]

export interface PathCheck {
  ok: boolean
  path: string
  why: string
}

export function checkPath(input: string): PathCheck {
  const path = resolve(input.replace(/^~(?=$|[\\/])/, HOME).trim())
  const lowered = path.toLowerCase()

  for (const bad of FORBIDDEN) {
    if (lowered === bad.toLowerCase() || lowered.startsWith(`${bad.toLowerCase()}${sep}`)) {
      return { ok: false, path, why: `${bad} is off limits` }
    }
  }

  const inside = ROOTS.some((root) => {
    const rel = relative(resolve(root), path)
    return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith(sep))
  })

  return inside
    ? { ok: true, path, why: '' }
    : {
        ok: false,
        path,
        why: `outside the folders this agent works in (${ROOTS[0]} and the project)`
      }
}

const MAX_READ = 200_000
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'out', '.next', '.cache', 'AppData'])

/* ----------------------------------------------------------- file_read */

export const fileRead = defineTool({
  name: 'file_read',
  kind: 'TOOL',
  description:
    'Read a file from disk. Give an absolute path, or a path relative to the working folder. Returns the contents as text.',
  params: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path.' },
      maxChars: { type: 'integer', description: 'How much to return (default 40000).' }
    },
    required: ['path']
  },
  async run(args): Promise<{ ok: boolean; output: string; data: unknown }> {
    const check = checkPath(String(args.path ?? ''))
    if (!check.ok) return { ok: false, output: `refused: ${check.why}`, data: null }

    try {
      const info = await stat(check.path)
      if (info.isDirectory()) {
        return { ok: false, output: `${check.path} is a directory — use file_list`, data: null }
      }
      const raw = await readFile(check.path, 'utf8')
      const maxChars = Math.min(MAX_READ, Math.max(200, Number(args.maxChars ?? 40000)))
      const text = raw.length > maxChars ? `${raw.slice(0, maxChars)}\n… (truncated)` : raw
      return {
        ok: true,
        output: `${basename(check.path)} · ${raw.length} chars`,
        data: { path: check.path, size: info.size, text }
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      return {
        ok: false,
        output:
          e.code === 'ENOENT' ? `no such file: ${check.path}` : `could not read: ${e.message}`,
        data: null
      }
    }
  }
})

/* ---------------------------------------------------------- file_write */

export const fileWrite = defineTool({
  name: 'file_write',
  kind: 'TOOL',
  description:
    'Write text to a file, creating it and any folders above it if needed. Overwrites the whole file. Always ask the user before you use this on a file that already exists with content you have not read.',
  params: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path.' },
      content: { type: 'string', description: 'The full text to write.' }
    },
    required: ['path', 'content']
  },
  async run(args): Promise<{ ok: boolean; output: string; data: unknown }> {
    const check = checkPath(String(args.path ?? ''))
    if (!check.ok) return { ok: false, output: `refused: ${check.why}`, data: null }

    const content = String(args.content ?? '')
    let existed = false
    try {
      await access(check.path, constants.F_OK)
      existed = true
    } catch {
      existed = false
    }

    try {
      await mkdir(dirname(check.path), { recursive: true })
      await writeFile(check.path, content, 'utf8')
      return {
        ok: true,
        output: `${existed ? 'overwrote' : 'wrote'} ${basename(check.path)} · ${content.length} chars`,
        data: { path: check.path, bytes: Buffer.byteLength(content), replaced_existing: existed }
      }
    } catch (err) {
      return { ok: false, output: `could not write: ${(err as Error).message}`, data: null }
    }
  }
})

/* ----------------------------------------------------------- file_list */

export const fileList = defineTool({
  name: 'file_list',
  kind: 'TOOL',
  description:
    'List what is in a folder, one level deep by default. Use it to see what exists before reading or writing anything.',
  params: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Folder path. Defaults to the working folder.' },
      deep: { type: 'boolean', description: 'Walk subfolders too (default false).' }
    }
  },
  async run(args): Promise<{ ok: boolean; output: string; data: unknown }> {
    const check = checkPath(String(args.path ?? process.cwd()))
    if (!check.ok) return { ok: false, output: `refused: ${check.why}`, data: null }

    const deep = args.deep === true
    const out: string[] = []
    let files = 0
    let folders = 0

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (out.length > 400 || depth > (deep ? 4 : 1)) return
      let entries: Dirent<string>[]
      try {
        entries = (await readdir(dir, { withFileTypes: true })) as Dirent<string>[]
      } catch (err) {
        out.push(`  ! ${(err as Error).message}`)
        return
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (SKIP_DIR.has(entry.name)) continue
        const full = join(dir, entry.name)
        const rel = relative(check.path, full) || entry.name
        if (entry.isDirectory()) {
          folders += 1
          out.push(`  ${rel}/`)
          if (deep) await walk(full, depth + 1)
        } else {
          files += 1
          let size = 0
          try {
            size = (await stat(full)).size
          } catch {
            /* unreadable entry, still list it */
          }
          out.push(`  ${rel}  (${size} b)`)
        }
      }
    }

    await walk(check.path, 0)
    return {
      ok: true,
      output: `${files} files, ${folders} folders in ${check.path}`,
      data: { path: check.path, entries: out.slice(0, 400) }
    }
  }
})

/* --------------------------------------------------------- file_search */

/**
 * Content search. Reads candidate files itself so the answer can quote the
 * matching line rather than just naming a file.
 */
export const fileSearch = defineTool({
  name: 'file_search',
  kind: 'RETRIEVER',
  description:
    'Find text inside files. Searches recursively from a folder and returns the matching lines with their file and line number.',
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regular expression to look for.' },
      path: { type: 'string', description: 'Folder to search. Defaults to the working folder.' },
      limit: { type: 'integer', description: 'Maximum matches (default 30).' }
    },
    required: ['query']
  },
  async run(args): Promise<{ ok: boolean; output: string; data: unknown }> {
    const check = checkPath(String(args.path ?? process.cwd()))
    if (!check.ok) return { ok: false, output: `refused: ${check.why}`, data: null }

    const query = String(args.query ?? '')
    if (!query) return { ok: false, output: 'no search text given', data: null }

    let pattern: RegExp
    try {
      pattern = new RegExp(query, 'i')
    } catch {
      pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }

    const limit = Math.min(200, Math.max(1, Number(args.limit ?? 30)))
    const TEXTUAL = new Set([
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.json',
      '.md',
      '.txt',
      '.html',
      '.css',
      '.yml',
      '.yaml',
      '.toml',
      '.env',
      '.py',
      '.go',
      '.rs',
      '.sh',
      '.ps1',
      '.csv'
    ])

    const hits: { file: string; line: number; text: string }[] = []

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (hits.length >= limit || depth > 6) return
      let entries: Dirent<string>[]
      try {
        entries = (await readdir(dir, { withFileTypes: true })) as Dirent<string>[]
      } catch {
        return
      }
      for (const entry of entries) {
        if (hits.length >= limit) return
        if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full, depth + 1)
          continue
        }
        if (!TEXTUAL.has(extname(entry.name).toLowerCase())) continue
        try {
          if ((await stat(full)).size > 1_500_000) continue
        } catch {
          continue
        }
        let text: string
        try {
          text = await readFile(full, 'utf8')
        } catch {
          continue
        }
        const lines = text.split('\n')
        for (let i = 0; i < lines.length && hits.length < limit; i++) {
          if (pattern.test(lines[i])) {
            hits.push({
              file: relative(check.path, full) || entry.name,
              line: i + 1,
              text: lines[i].trim().slice(0, 200)
            })
          }
        }
      }
    }

    await walk(check.path, 0)
    return {
      ok: hits.length > 0,
      output: hits.length ? `${hits.length} matches` : `nothing matches /${query}/`,
      data: { query, path: check.path, matches: hits }
    }
  }
})
