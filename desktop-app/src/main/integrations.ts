import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  EntireStatus,
  NeatlogsStatus,
  SpanKind,
  SpanRecord,
  SpanStatus
} from '../shared/types'

const exec = promisify(execFile)

/* ==========================================================================
   neatlogs — the traces this product is built on.

   Every sentence the agent says is rendered from a span. If tracing is off,
   the app still runs, but the "underneath" layer becomes a local record
   rather than an exported trace. We never fake an export.
   ========================================================================== */

type NeatlogsModule = {
  init?: (opts: Record<string, unknown>) => Promise<unknown>
  trace?: <T>(
    opts: Record<string, unknown>,
    fn: (active: Record<string, unknown>) => Promise<T>
  ) => Promise<T>
  flush?: () => Promise<void>
  shutdown?: () => Promise<void>
}

export interface StepMeta {
  kind: SpanKind
  name: string
  input: string
  output: string
  tokens?: [number, number]
  cost?: number
  status?: SpanStatus
  error?: string
}

/** Runs one unit of work and returns the span it produced. */
export type Step = (meta: StepMeta, work: () => Promise<string | void>) => Promise<SpanRecord>

let nl: NeatlogsModule | null = null

export const tracing = {
  status: {
    installed: false,
    connected: false,
    workflow: 'done-desktop',
    spansExported: 0,
    lastExportAt: null,
    error: null
  } as NeatlogsStatus,

  async init(): Promise<NeatlogsStatus> {
    try {
      const mod = (await import('neatlogs')) as unknown as NeatlogsModule
      if (!mod.init || !mod.trace) throw new Error('installed, but init()/trace() missing')
      nl = mod

      const apiKey = process.env.NEATLOGS_API_KEY?.trim()
      if (!apiKey) {
        this.status = {
          ...this.status,
          installed: true,
          connected: false,
          error: 'No NEATLOGS_API_KEY set — spans are recorded locally but not exported.'
        }
        return this.status
      }

      await mod.init({
        apiKey,
        workflowName: 'done-desktop',
        tags: ['neatHack', 'desktop'],
        captureLogs: true
      })
      this.status = { ...this.status, installed: true, connected: true, error: null }
    } catch (err) {
      this.status = {
        ...this.status,
        installed: false,
        connected: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
    return this.status
  },

  /**
   * Opens a trace for one run of one task. `body` receives a `step` helper;
   * each step becomes a real span, nested under the workflow root.
   */
  async run<T>(
    meta: { name: string; taskId: string },
    body: (step: Step) => Promise<T>
  ): Promise<{ value: T; spans: SpanRecord[] }> {
    const spans: SpanRecord[] = []

    const step: Step = async (m, work) => {
      const start = Date.now()
      let output = m.output
      let error: string | undefined

      if (nl?.trace) {
        output = await nl.trace(
          {
            name: m.name,
            kind: m.kind,
            sessionId: meta.taskId
          },
          async () => {
            try {
              const r = await work()
              if (typeof r === 'string') output = r
              return r ?? output
            } catch (e) {
              error = e instanceof Error ? e.message : String(e)
              throw e
            }
          }
        )
      } else {
        const r = await work()
        if (typeof r === 'string') output = r
      }

      const end = Date.now()
      const span: SpanRecord = {
        id: `${meta.taskId}-${spans.length}`,
        parentId: meta.taskId,
        kind: m.kind,
        name: m.name,
        input: m.input,
        output,
        start,
        end,
        durationMs: Math.max(1, end - start),
        status: error ? 'error' : (m.status ?? 'ok'),
        tokens: m.tokens ? { input: m.tokens[0], output: m.tokens[1] } : null,
        cost: m.cost ?? null,
        ...(error ? { error } : {}),
        exported: Boolean(nl?.trace) && this.status.connected
      }

      if (span.exported) {
        this.status.spansExported += 1
        this.status.lastExportAt = Date.now()
      }
      spans.push(span)
      return span
    }

    if (!nl?.trace) {
      return { value: await body(step), spans }
    }

    try {
      const value = await nl.trace(
        { name: meta.name, kind: 'WORKFLOW', sessionId: meta.taskId },
        () => body(step) as Promise<T>
      )
      await nl.flush?.()
      return { value, spans }
    } catch (err) {
      this.status.error = err instanceof Error ? err.message : String(err)
      this.status.connected = false
      return { value: await body(step), spans }
    }
  },

  async flush(): Promise<void> {
    try {
      await nl?.flush?.()
    } catch {
      /* best effort on shutdown */
    }
  },

  async shutdown(): Promise<void> {
    try {
      await nl?.flush?.()
      await nl?.shutdown?.()
    } catch {
      /* best effort on shutdown */
    }
  }
}

/* ==========================================================================
   Entire — the reasoning behind every change to how the agent behaves.

   Entire is a Go binary, not an npm package. We detect it, and when a
   behaviour change is made we write the behaviour, commit it, and let
   Entire's git hook turn the commit into a checkpoint linked to the session.
   ========================================================================== */

export interface CheckpointRequest {
  title: string
  summary: string
  behaviour: Record<string, unknown>
}

export interface CheckpointResult {
  ok: boolean
  id: string | null
  message: string
}

async function run(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(cmd, args, {
      cwd,
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, ENTIRE_NO_AUTO_UPDATE: '1' }
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? 'failed'
    }
  }
}

/** Walks up from `from` looking for a git repository root. */
function findRepoRoot(from: string): string | null {
  let dir = resolve(from)
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
  return null
}

export const entire = {
  repoRoot: null as string | null,

  async detect(startPath: string): Promise<EntireStatus> {
    const repoPath = findRepoRoot(startPath)
    this.repoRoot = repoPath

    if (!repoPath) {
      return {
        installed: false,
        version: null,
        enabled: false,
        checkpoints: 0,
        lastCheckpointId: null,
        lastCheckpointAt: null,
        repoPath: null,
        error: 'No git repository found. Initialise one to start checkpointing.'
      }
    }

    const v = await run('entire', ['version'], repoPath)
    if (v.code !== 0) {
      return {
        installed: false,
        version: null,
        enabled: false,
        checkpoints: 0,
        lastCheckpointId: null,
        lastCheckpointAt: null,
        repoPath,
        error: 'Entire CLI not found on PATH.'
      }
    }

    const version = (v.stdout.split('\n')[0] || '').trim() || 'installed'
    const enabled = existsSync(join(repoPath, '.entire'))
    const list = enabled
      ? await this.listCheckpoints()
      : { checkpoints: 0, lastId: null, lastAt: null }

    return {
      installed: true,
      version,
      enabled,
      checkpoints: list.checkpoints,
      lastCheckpointId: list.lastId,
      lastCheckpointAt: list.lastAt,
      repoPath,
      error: enabled ? null : 'Repo found, but Entire is not enabled here yet.'
    }
  },

  async listCheckpoints(): Promise<{
    checkpoints: number
    lastId: string | null
    lastAt: number | null
  }> {
    if (!this.repoRoot) return { checkpoints: 0, lastId: null, lastAt: null }
    const r = await run('entire', ['checkpoint', 'list', '--json', '--no-pager'], this.repoRoot)
    if (r.code !== 0) return { checkpoints: 0, lastId: null, lastAt: null }
    try {
      const parsed = JSON.parse(r.stdout) as unknown
      const rows: Record<string, unknown>[] = Array.isArray(parsed)
        ? (parsed as Record<string, unknown>[])
        : (((parsed as Record<string, unknown>)?.checkpoints as Record<string, unknown>[]) ?? [])
      const first = rows[0] ?? {}
      const stamp = first.created_at ?? first.createdAt ?? first.date
      const at = stamp ? Date.parse(String(stamp)) : null
      return {
        checkpoints: rows.length,
        lastId: (first.id ?? first.checkpoint_id ?? null) as string | null,
        lastAt: at && !Number.isNaN(at) ? at : null
      }
    } catch {
      return { checkpoints: 0, lastId: null, lastAt: null }
    }
  },

  /**
   * Record a behaviour change as a checkpoint: write the behaviour, commit it,
   * then read back the checkpoint Entire created for that commit.
   */
  async checkpoint(req: CheckpointRequest): Promise<CheckpointResult> {
    if (!this.repoRoot) {
      return { ok: false, id: null, message: 'No git repository to checkpoint into.' }
    }
    const status = await this.detect(this.repoRoot)
    if (!status.enabled) {
      return {
        ok: false,
        id: null,
        message: 'Entire is not enabled here. Run: entire enable -y --agent opencode'
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const rel = join('.done', 'behaviour', `${stamp}.json`)
    const abs = join(this.repoRoot, rel)
    const body = JSON.stringify(
      {
        title: req.title,
        summary: req.summary,
        at: new Date().toISOString(),
        behaviour: req.behaviour
      },
      null,
      2
    )

    try {
      const { writeFile, mkdir } = await import('node:fs/promises')
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, `${body}\n`, 'utf8')
    } catch (err) {
      return { ok: false, id: null, message: `Could not write behaviour file: ${String(err)}` }
    }

    await run('git', ['add', '--', rel], this.repoRoot)
    const commit = await run(
      'git',
      [
        '-c',
        'user.name=done',
        '-c',
        'user.email=done@localhost',
        'commit',
        '-m',
        `behaviour: ${req.title}`
      ],
      this.repoRoot
    )
    if (commit.code !== 0) {
      return { ok: false, id: null, message: commit.stderr.split('\n')[0] || 'Nothing to commit.' }
    }

    const list = await this.listCheckpoints()
    return {
      ok: true,
      id: list.lastId,
      message: list.lastId
        ? `Checkpointed — Entire recorded ${list.lastId}`
        : 'Committed. Entire will link the next session to this commit.'
    }
  },

  async setup(repoPath: string): Promise<CheckpointResult> {
    const init = await run('git', ['init'], repoPath)
    if (init.code !== 0) {
      return { ok: false, id: null, message: init.stderr.split('\n')[0] || 'git init failed' }
    }
    const enable = await run('entire', ['enable', '-y', '--agent', 'opencode'], repoPath)
    if (enable.code !== 0) {
      return {
        ok: false,
        id: null,
        message:
          'git initialised, but Entire could not be enabled. Install the CLI: iex "& {$(irm https://entire.io/install.ps1)} | iex"'
      }
    }
    return {
      ok: true,
      id: null,
      message: 'Entire enabled. Behaviour changes are checkpointed from now on.'
    }
  }
}
