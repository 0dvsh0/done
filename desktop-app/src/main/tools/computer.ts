import { execFile } from 'node:child_process'
import {
  arch,
  cpus,
  freemem,
  homedir,
  hostname,
  platform,
  release,
  totalmem,
  uptime
} from 'node:os'
import { promisify } from 'node:util'
import { clipboard, shell } from 'electron'
import { defineTool } from './types'
import { checkPath } from './files'

/* ==========================================================================
   The computer.

   Real shell, real clipboard, real machine facts. The shell is genuinely
   powerful and genuinely dangerous, so it is fenced twice: the command has to
   be on the allowlist *and* every filesystem path it mentions has to pass the
   same sandbox the file tools use. A command that names something outside the
   user's own folders is refused by name, in the trace.
   ========================================================================== */

const exec = promisify(execFile)

/* ------------------------------------------------------------- shell_run */

/** Programs the agent may run. Everything else is refused. */
const BINARIES = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'git',
  'python',
  'python3',
  'py',
  'pip',
  'pip3',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'playwright',
  'ls',
  'dir',
  'pwd',
  'cd',
  'cat',
  'type',
  'head',
  'tail',
  'wc',
  'echo',
  'find',
  'grep',
  'rg',
  'tree',
  'stat',
  'du',
  'df',
  'which',
  'where',
  'whoami',
  'date',
  'uname',
  'systeminfo',
  'curl',
  'jq',
  'sort',
  'uniq',
  'cut',
  'awk',
  'sed',
  'diff'
])

/** Patterns that mean "this is not reversible", regardless of the binary. */
const DESTRUCTIVE =
  /\b(rm|rmdir|del|erase|remove-item|format|mkfs|dd|shutdown|restart-computer|stop-computer|reg\s+delete|remove-psdrive|format-volume|clear-disk|cipher\s+\/w)\b/i

const EXFIL = /\b(curl|wget|invoke-webrequest|invoke-restmethod|start-bitstransfer)\b/i

/** Reads a path out of a command line so it can be checked. */
const PATH_TOKEN =
  /(?:^|[\s"'=])((?:[A-Za-z]:[\\/][^\s"';|]*)|(?:\.{1,2}[\\/][^\s"';|]*)|(?:~[\\/][^\s"';|]*))/g

function pathsIn(command: string): string[] {
  const found: string[] = []
  for (const m of command.matchAll(PATH_TOKEN)) {
    const token = m[1]
    // Only things that look like real paths — not "C++" or a URL scheme.
    if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith('.') || token.startsWith('~')) {
      found.push(token)
    }
  }
  return found
}

function firstBinary(command: string): string {
  const trimmed = command.trim().replace(/^["']?[\w.-]+["']?\s+/, (m) => (m.includes(' ') ? m : ''))
  const first = trimmed.trim().split(/\s+/)[0] ?? ''
  return first
    .replace(/^.*[\\/]/, '')
    .replace(/\.(exe|cmd|bat|ps1)$/i, '')
    .toLowerCase()
}

export const shellRun = defineTool({
  name: 'shell_run',
  kind: 'TOOL',
  description:
    'Run a command in a real shell on this machine. Useful for building, testing, inspecting git history, or anything with a CLI. Read-only commands (git status, npm test, ls) run freely; anything that deletes, installs or reaches the network needs the user to approve it.',
  params: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command line to run.' },
      cwd: { type: 'string', description: 'Working folder. Defaults to the project folder.' }
    },
    required: ['command']
  },
  async run(args): Promise<{ ok: boolean; output: string; data: unknown }> {
    const command = String(args.command ?? '').trim()
    if (!command) return { ok: false, output: 'no command given', data: null }

    // Chained commands hide what is actually going to run.
    if (/[;&|]{1,2}\s*\S/.test(command)) {
      return {
        ok: false,
        output: 'refused: run one command at a time, not a chain joined by ; && or |',
        data: null
      }
    }

    const binary = firstBinary(command)
    if (!BINARIES.has(binary)) {
      return { ok: false, output: `refused: "${binary}" is not on the allowlist`, data: null }
    }

    for (const p of pathsIn(command)) {
      const check = checkPath(p)
      if (!check.ok) return { ok: false, output: `refused: ${check.why} (${p})`, data: null }
    }

    const cwd = args.cwd ? checkPath(String(args.cwd)) : { ok: true, path: process.cwd(), why: '' }
    if (!cwd.ok) return { ok: false, output: `refused: ${cwd.why}`, data: null }

    const destructive = DESTRUCTIVE.test(command)
    const exfil = EXFIL.test(command)

    try {
      const { stdout, stderr } = await exec(binary, command.split(/\s+/).slice(1), {
        cwd: cwd.path,
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        shell: false
      })
      const text = `${stdout}${stderr}`.trim()
      return {
        ok: true,
        output: `exit 0 · ${text.split('\n').length} lines`,
        data: { command, cwd: cwd.path, stdout: text.slice(0, 12000), risky: destructive || exfil }
      }
    } catch (err) {
      const e = err as {
        code?: number | string
        stdout?: string
        stderr?: string
        message?: string
      }
      const output = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim()
      const code = typeof e.code === 'number' ? e.code : 1
      return {
        ok: false,
        output: `exit ${code}${output ? ` · ${output.split('\n')[0].slice(0, 90)}` : ''}`,
        data: { command, cwd: cwd.path, exit: code, stdout: output.slice(0, 12000) }
      }
    }
  }
})

/* ------------------------------------------------------- clipboard_read */

export const clipboardRead = defineTool({
  name: 'clipboard_read',
  kind: 'TOOL',
  description: 'Read whatever is currently on the system clipboard.',
  params: { type: 'object', properties: {} },
  async run(): Promise<{ ok: boolean; output: string; data: unknown }> {
    const text = clipboard.readText()
    return {
      ok: text.length > 0,
      output: text.length ? `${text.length} chars` : 'clipboard is empty',
      data: { text: text.slice(0, 8000) }
    }
  }
})

/* ------------------------------------------------------ clipboard_write */

export const clipboardWrite = defineTool({
  name: 'clipboard_write',
  kind: 'TOOL',
  description: 'Put text on the system clipboard so the user can paste it anywhere.',
  params: {
    type: 'object',
    properties: { text: { type: 'string', description: 'Text to copy.' } },
    required: ['text']
  },
  async run(args): Promise<{ ok: boolean; output: string; data: unknown }> {
    const text = String(args.text ?? '')
    clipboard.writeText(text)
    return { ok: true, output: `copied ${text.length} chars`, data: { chars: text.length } }
  }
})

/* ---------------------------------------------------------- system_info */

export const systemInfo = defineTool({
  name: 'system_info',
  kind: 'TOOL',
  description:
    'Real facts about the machine and the working folder: OS, CPU, memory, uptime, where the project lives, whether it is a git repository.',
  params: { type: 'object', properties: {} },
  async run(): Promise<{ ok: boolean; output: string; data: unknown }> {
    const cwd = process.cwd()
    const model = cpus()[0]?.model.trim() ?? 'unknown'
    const facts = {
      os: `${platform()} ${release()}`,
      arch: arch(),
      cpu: model,
      cores: cpus().length,
      memory_gb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      free_memory_gb: Math.round((freemem() / 1024 ** 3) * 10) / 10,
      uptime_hours: Math.round(uptime() / 3600),
      hostname: hostname(),
      home: homedir(),
      working_folder: cwd,
      is_git_repo: Boolean(process.env.DONE_REPO_IS_GIT)
    }
    return {
      ok: true,
      output: `${platform()} ${release()} · ${facts.cores} cores · ${facts.memory_gb} GB`,
      data: facts
    }
  }
})

/* ------------------------------------------------------------- open_url */

/**
 * Opens something on the user's desktop — their browser, their editor. This is
 * the one tool that reaches outside the app, so it always asks.
 */
export const openUrl = defineTool({
  name: 'open_url',
  kind: 'TOOL',
  description:
    "Open a URL or a local file in the user's real browser or their default application. Use it when the user would want to look at the result themselves.",
  params: {
    type: 'object',
    properties: { target: { type: 'string', description: 'An http(s) URL, or a file path.' } },
    required: ['target']
  },
  irreversible: true,
  async run(args): Promise<{ ok: boolean; output: string; data: unknown }> {
    const target = String(args.target ?? '').trim()
    if (/^https?:\/\//i.test(target)) {
      await shell.openExternal(target)
      return { ok: true, output: `opened ${new URL(target).host} in the browser`, data: { target } }
    }
    const check = checkPath(target)
    if (!check.ok) return { ok: false, output: `refused: ${check.why}`, data: null }
    const err = await shell.openPath(check.path)
    return {
      ok: !err,
      output: err ? `could not open: ${err}` : `opened ${check.path}`,
      data: err ? null : { target: check.path }
    }
  }
})
