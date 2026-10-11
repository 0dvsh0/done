import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from './types'
import { checkPath } from './files'

/* ==========================================================================
   Coding, delegated to a real coding agent.

   Rather than pretending this app can refactor a codebase, it hands the job
   to `opencode` — the same agent you would use yourself — running in a real
   directory, and reports back what actually happened: what it said, which
   files it touched, what the tests did.

   The run is never taken on trust. The file list comes from `git status`
   read off the disk afterwards, not from anything the agent claims.
   ========================================================================== */

export interface CodeRunSummary {
  exit: number | null
  text: string
  filesTouched: string[]
  steps: number
  truncated: boolean
}

/**
 * Runs `opencode run` and collects what it printed.
 *
 * Deliberately the default output format rather than `--format json`. The JSON
 * event stream was verified to emit nothing at all in opencode 1.18.32 on
 * Windows — the process runs, does the work, exits, and writes zero bytes to
 * stdout in that mode — so a parser written against it would report "the agent
 * did nothing" every single time. The text report, plus a real `git status`
 * read afterwards, is both simpler and more trustworthy.
 */
export function runOpencode(
  prompt: string,
  dir: string,
  opts: { model?: string; auto?: boolean; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<CodeRunSummary> {
  // Generous, because the model behind `opencode` may itself be a free one and
  // a real coding task legitimately takes minutes. Env-overridable so a slow
  // setup can be shortened without a rebuild.
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DONE_CODE_TIMEOUT ?? 900_000)

  return new Promise((resolve) => {
    const args = ['run', '--dir', dir]
    if (opts.model) args.push('--model', opts.model)
    if (opts.auto) args.push('--auto')
    args.push(prompt)

    const child = spawn(opencodeBin(), args, {
      cwd: dir,
      windowsHide: true,
      shell: false,
      env: { ...process.env, ENTIRE_NO_AUTO_UPDATE: '1' }
    })

    const summary: CodeRunSummary = {
      exit: null,
      text: '',
      filesTouched: [],
      steps: 0,
      truncated: false
    }
    const chunks: string[] = []
    let settled = false

    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      const all = chunks.join('').trim()
      summary.text = clean(all).slice(0, 20000)
      summary.truncated = all.length > 20000
      summary.steps = summary.text ? summary.text.split('\n').filter(Boolean).length : 0
      resolve(summary)
    }

    const onAbort = (): void => {
      kill(child.pid)
      finish()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => {
      kill(child.pid)
      summary.exit = -1
      chunks.push('\n(stopped: the coding agent went past its time limit and was terminated)')
      finish()
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = clean(chunk.toString())
      if (text) chunks.push(`\n${text}`)
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      chunks.push(
        err.code === 'ENOENT'
          ? 'opencode CLI is not on PATH — install it with: npm i -g opencode-ai'
          : `could not start opencode: ${err.message}`
      )
      summary.exit = -1
      finish()
    })

    child.on('close', (code) => {
      summary.exit = code
      finish()
    })
  })
}

/**
 * Strips the terminal escape codes the CLI wraps its report in, so the span
 * carries the agent's words rather than colour codes.
 *
 * Done with a scan rather than a regex because these are literal control
 * characters, and a regex containing one is the kind of thing that quietly
 * breaks when a file gets re-encoded.
 */
function clean(text: string): string {
  const ESC = String.fromCharCode(27)
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ESC) {
      out += text[i]
      continue
    }
    // Skip to the final byte of the sequence: CSI runs to a letter, OSC runs to
    // BEL or ST. Either way, the first letter ends it.
    let j = i + 1
    if (text[j] === '[') j++
    while (j < text.length && !/[A-Za-z]/.test(text[j])) j++
    i = j
  }

  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim()
}

/**
 * The real executable, not the `opencode.cmd` shim.
 *
 * The shim routes through cmd.exe, which on Windows can block-buffer the
 * child's stdout until the process exits — so a streaming integration sees
 * nothing at all until the agent has already finished.
 */
function opencodeBin(): string {
  if (process.env.DONE_OPENCODE_BIN) return process.env.DONE_OPENCODE_BIN
  if (process.platform !== 'win32') return 'opencode'

  const roots = [process.env.APPDATA, join(homedir(), 'AppData', 'Roaming')]
  for (const root of roots) {
    if (!root) continue
    const exe = join(root, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
    if (existsSync(exe)) return exe
  }
  // Fall back to the shim. Correctness beats streaming.
  return 'opencode'
}

/**
 * Kills the whole process tree.
 *
 * The child is spawned through a shell on Windows, so killing the child pid
 * only kills the shell — the agent itself keeps running, burns CPU and holds
 * its working directory. `taskkill /T` is the only thing that actually stops it.
 */
function kill(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    }).on('error', () => undefined)
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

export const codeAgent = defineTool({
  name: 'code_agent',
  kind: 'AGENT',
  description:
    'Hand a coding job to a real coding agent (the opencode CLI) working in a folder on this machine. It reads the code, edits files and runs tests itself. Use this for anything that means writing or changing code — implementing a feature, fixing a bug, writing tests, reviewing a diff. Returns what the agent did and which files changed.',
  params: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'What to build, fix or review. Be specific.' },
      dir: { type: 'string', description: 'Folder to work in. Defaults to the project folder.' },
      model: {
        type: 'string',
        description: 'Optional model override, e.g. "groq/openai-gpt-oss-120b".'
      },
      auto: {
        type: 'boolean',
        description:
          'Let the coding agent run its own commands without stopping for permission. Leave true unless it hangs.'
      }
    },
    required: ['task']
  },
  irreversible: true,
  async run(args, ctx): Promise<{ ok: boolean; output: string; data: unknown }> {
    const task = String(args.task ?? '').trim()
    if (!task) return { ok: false, output: 'no task given', data: null }

    const dir = checkPath(String(args.dir ?? process.cwd()))
    if (!dir.ok) return { ok: false, output: `refused: ${dir.why}`, data: null }

    // `opencode run` is non-interactive: with permissions left to prompt, it
    // waits forever for an answer that cannot arrive and the run hangs until
    // the timeout. The user has already approved this delegation through the
    // guardrail, which is the check that was supposed to protect them.
    const auto = args.auto === undefined ? true : args.auto === true

    const before = await diffStat(dir.path)
    const summary = await runOpencode(task, dir.path, {
      model: args.model ? String(args.model) : process.env.DONE_CODE_MODEL || undefined,
      auto,
      signal: ctx.signal
    })

    if (summary.exit === -1 && !summary.text) {
      return {
        ok: false,
        output: 'could not start the coding agent (is `opencode` on PATH?)',
        data: { dir: dir.path, task }
      }
    }

    const after = await diffStat(dir.path)
    // Dirty now, minus what was already dirty before the agent started. This
    // is read off the working tree rather than taken from the agent's word.
    const touched = [...after.files].filter((f) => !before.files.has(f))

    const ok = summary.exit === 0 && summary.text.length > 0
    return {
      ok,
      output: ok
        ? `${summary.steps} steps · ${touched.length} files changed`
        : `coding agent exited ${summary.exit}`,
      data: {
        task,
        dir: dir.path,
        exit: summary.exit,
        report: summary.text,
        files_changed: touched.slice(0, 40)
      }
    }
  }
})

/* ------------------------------------------------------------ git support */

interface DiffStat {
  files: Set<string>
}

/** Real `git status`, so "it changed these files" is checked rather than claimed. */
export async function diffStat(dir: string): Promise<DiffStat> {
  const files = new Set<string>()
  try {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('git', ['status', '--porcelain'], {
        cwd: dir,
        windowsHide: true,
        shell: process.platform === 'win32'
      })
      let out = ''
      child.stdout.on('data', (c: Buffer) => (out += c.toString()))
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve({ stdout: out, stderr: '' }) : reject(new Error('not a repo'))
      )
    })
    for (const line of stdout.split('\n')) {
      const name = line
        .slice(3)
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .split(' -> ')
        .pop()
      if (name) files.add(name)
    }
  } catch {
    /* not a git repo — the coding agent's own report is what we have */
  }
  return { files }
}
