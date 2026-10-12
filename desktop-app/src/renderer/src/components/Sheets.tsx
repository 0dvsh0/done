import { useEffect, useState } from 'react'
import type { AppState, ConnectorInfo, Economics, Limits } from '../../../shared/types'
import { ago, cx, money, tiny } from '../lib/format'
import { api, toast, useUI } from '../store'
import * as I from './Icons'
import { Kbd } from './Icons'
import { Button, Code, Field, Segmented, Sheet, Switch } from './primitives'

/** `openai/gpt-oss-120b` reads as a path in a sentence. `gpt-oss-120b` does not. */
const shortModel = (id: string): string => (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id)

export function Sheets({ state }: { state: AppState }): React.JSX.Element {
  const sheet = useUI((s) => s.sheet)
  const close = (): void => useUI.getState().showSheet(null)

  return (
    <>
      <LimitsSheet open={sheet === 'limits'} onClose={close} limits={state.limits} />
      <ShortcutsSheet open={sheet === 'shortcuts'} onClose={close} />
      <AgentSheet open={sheet === 'agent'} onClose={close} state={state} />
      <ConnectionsSheet open={sheet === 'connections'} onClose={close} state={state} />
    </>
  )
}

/* ---------------------------------------------------------------- limits */

/** The steps the spend control offers. $0 has to be the first of them. */
const BUDGET_SCALE = [0, 0.05, 0.25, 1, 5, 25]

function LimitsSheet({
  open,
  onClose,
  limits
}: {
  open: boolean
  onClose: () => void
  limits: Limits
}): React.JSX.Element {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="What it can do on its own"
      subtitle="It starts careful. You can loosen it whenever you trust it more."
    >
      <Field
        title="Run on its own until it costs this much"
        hint="Real money, measured off the token counts the model actually returns. At $0 it stops and asks before the first call."
      >
        <Segmented
          ariaLabel="Run cost before it asks"
          value={limits.spend}
          /* A control that only lights up for four of the values it can hold
             reads as broken the moment a different number is in effect — and
             this one is set from three places. Anything outside the scale falls
             back to showing the real number rather than showing nothing. */
          options={BUDGET_SCALE.map((v) => ({
            value: v,
            label: v === 0 ? '$0' : v < 1 ? `${Math.round(v * 100)}¢` : `$${v}`
          }))}
          fallbackLabel={limits.spend === 0 ? '$0' : money(limits.spend)}
          onChange={(v) => {
            void api.limits({ spend: v })
            toast(
              v > 0
                ? `It will now run on its own up to ${money(v)} a job.`
                : 'It will ask before every job that costs anything.',
              true
            )
          }}
        />
      </Field>

      <Field
        locked
        title="Never do anything that can’t be undone"
        hint="Writing over a file, opening something on your desktop, handing code to another agent. Always asks. This one stays on."
      >
        <span className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-4">
            <I.Padlock className="[&_svg]:h-[12px] [&_svg]:w-[12px]" />
            Always
          </span>
          <Switch checked locked label="Never do anything that can’t be undone" />
        </span>
      </Field>

      <Field title="Quiet hours" hint="Hold questions between 10pm and 8am.">
        <Switch
          checked={limits.quiet}
          label="Quiet hours"
          onChange={(v) => void api.limits({ quiet: v })}
        />
      </Field>

      <p className="pt-4 text-[11.5px] leading-relaxed text-fg-3">
        Every step is traced end to end — the model call, the tool, the answer it checked — so you
        can always see exactly what happened and what it cost. Turn on <Code>NEATLOGS_API_KEY</Code>{' '}
        and the same runs land in your dashboard.
      </p>
    </Sheet>
  )
}

/* ------------------------------------------------------------- shortcuts */

const KEYS: [string, string[]][] = [
  ['Write something new', ['N']],
  ['Move through your list', ['J', 'K']],
  ['Open', ['↵']],
  ['Pause or resume', ['Space']],
  ['Steer', ['S']],
  ['Take over', ['T']],
  ['Light or dark', ['⇧', 'L']],
  ['Search anything', ['⌘', 'K']],
  ['Look under the hood', ['⌘', 'T']],
  ['Undo the last thing', ['⌘', 'Z']],
  ['Close', ['Esc']]
]

function ShortcutsSheet({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} title="Shortcuts" width={460}>
      <dl>
        {KEYS.map(([label, keys]) => (
          <div
            key={label}
            className="flex items-center justify-between border-b border-line py-[9px] last:border-b-0"
          >
            <dt className="text-[13px] text-fg-2">{label}</dt>
            <dd className="flex gap-[5px]">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  )
}

/* ---------------------------------------------------------------- agent */

function AgentSheet({
  open,
  onClose,
  state
}: {
  open: boolean
  onClose: () => void
  state: AppState
}): React.JSX.Element {
  const [econ, setEcon] = useState<Economics | null>(null)
  const model = state.integrations.model

  useEffect(() => {
    if (!open) return
    void window.system.economics().then(setEcon)
  }, [open, state.rev])

  const finishedRuns = Object.values(state.spans).filter((run) =>
    run.some((s) => s.kind === 'CHAIN' && s.name === 'task_complete')
  ).length
  const measured = finishedRuns >= 3

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="What it can do"
      subtitle="Real tools, real latency, real token counts."
      width={620}
    >
      <div className="pb-4">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[11px] border border-line bg-line">
          <Cell
            label="Engines"
            value={`${state.integrations.connectors.length}`}
            hint="same tools, different approach"
          />
          {/* The model reads as a statistic here, not a headline. It was set
              at the size of the numbers around it and given the same weight
              as the things the agent can *do* — which made a version string
              look like a feature. */}
          <Cell
            label="Model"
            value={model.model.replace(/^.*\//, '')}
            hint={`${model.model.includes('/') ? model.model.split('/')[0] : 'Groq'} · 128k context`}
            mono
          />
          <Cell
            label="Injection guard"
            value="On"
            hint="every page it reads is screened"
            tone="good"
          />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[11px] border border-line bg-line">
          <Cell
            label="Avg cost / task"
            value={econ ? tiny(econ.costPerPeriod) : '—'}
            hint={
              measured ? `measured over ${finishedRuns} runs` : `${finishedRuns} completed so far`
            }
          />
          <Cell label="Tools" value="19" hint="browser, shell, files, clipboard" />
          <Cell
            label="Runs finished"
            value={String(finishedRuns)}
            hint="verified before called done"
          />
        </div>

        <h3 className="mt-5 mb-2 text-[10.5px] font-medium tracking-[0.09em] text-fg-3 uppercase">
          How it works
        </h3>

        <div className="space-y-2 text-[12px] text-fg-2">
          <div className="rounded-[8px] border border-line bg-ink-1 p-2.5">
            <span className="font-medium text-fg">It acts, it does not describe</span>
            <p className="mt-0.5 text-fg-3">
              Every engine carries the same tools: a real browser, a real shell, and direct
              filesystem access. A tool either returns a result or it fails, and the trace shows
              which.
            </p>
          </div>

          <div className="rounded-[8px] border border-line bg-ink-1 p-2.5">
            <span className="font-medium text-fg">It checks its own work</span>
            <p className="mt-0.5 text-fg-3">
              A run that finishes is handed to a separate pass that reads the tool results and
              decides whether the goal was actually met. If the evidence is not there, the task is
              reported as unfinished rather than done.
            </p>
          </div>

          <div className="rounded-[8px] border border-line bg-ink-1 p-2.5">
            <span className="font-medium text-fg">It asks before anything irreversible</span>
            <p className="mt-0.5 text-fg-3">
              Overwriting a file, running a command, handing work to another agent — always a
              question first, and the answer is yours. Spending is capped the same way, against the
              token counts the provider actually returns.
            </p>
          </div>
        </div>

        <p className="mt-4 text-[11.5px] leading-relaxed text-fg-3">
          If a step cannot be completed, the task says so and says why. Nothing is filled in to make
          a run look finished.
        </p>
      </div>
    </Sheet>
  )
}

function Cell({
  label,
  value,
  hint,
  tone,
  mono
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good'
  /** Set only for values that are identifiers — a model id, a version. */
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="bg-ink-1 px-3.5 py-3">
      <p className="text-[10.5px] tracking-[0.05em] text-fg-3 uppercase">{label}</p>
      <p
        className={cx(
          'mt-1 truncate text-[17px] leading-tight',
          mono && 'font-mono text-[14px]',
          tone === 'good' ? 'text-calm' : 'text-fg'
        )}
        title={value}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[10.5px] leading-snug text-fg-3">{hint}</p>}
    </div>
  )
}

/* ----------------------------------------------------------- connections */

/**
 * Shown only if the main process has not reported yet.
 *
 * Every engine here carries the same real tools, so there is nothing to
 * "connect" — it either has a provider key to think with or it cannot run.
 * The previous version of this sheet carried a hardcoded list claiming some
 * engines were connected and the rest were not, which is a picture of the
 * world that had no connection to the world. The truth comes from the main
 * process, which reads the keys and reports which model each engine resolves
 * to.
 */
const FALLBACK_CONNECTORS: ConnectorInfo[] = [
  {
    id: 'pi',
    name: 'Pi',
    blurb: 'The default engine. Runs on this machine.',
    category: 'desktop',
    badge: 'Pi',
    icon: 'pi',
    description: 'Local engine with the full tool set.',
    connected: false,
    native: true
  }
]

function getConnectorIcon(id: string): React.JSX.Element {
  switch (id) {
    case 'claude':
      return <I.Terminal className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-fg-3" />
    case 'grok':
      return <I.Zap className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-fg-3" />
    case 'chatgpt':
      return <I.Bot className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-fg-3" />
    case 'muse':
      return <I.Sparkles className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-fg-3" />
    case 'gemini':
      return <I.Sparkles className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-fg-3" />
    case 'github':
      return <I.Overlap className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-fg-3" />
    case 'pi':
    default:
      return <I.Bot className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-fg-3" />
  }
}

/** Where a key for this engine comes from, and what it unlocks. */
const KEY_HINT: Record<string, string> = {
  claude: 'Anthropic API Key (sk-ant-…)',
  grok: 'xAI API Key (xai-…)',
  chatgpt: 'OpenAI API Key (sk-…)',
  gemini: 'Gemini API Key (AIza…)',
  github: 'GitHub Token (ghp_…) — optional, raises the rate limit'
}

function ConnectorCard({
  connector,
  onSaved
}: {
  connector: ConnectorInfo
  onSaved: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState(connector.endpoint ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const res = await api.setConnectorConfig(connector.id, {
        apiKey: apiKey.trim() || undefined,
        endpoint: endpoint.trim() || undefined
      })
      toast(res.message, res.ok)
      setEditing(false)
      onSaved()
    } catch (err) {
      toast(`Failed to save: ${String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const needsKey = Boolean(connector.requiresKey)
  const running = connector.native !== false

  return (
    <div className="flex flex-col justify-between rounded-[9px] border border-line bg-ink-1 p-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {getConnectorIcon(connector.id)}
            <span className="text-[12.5px] font-medium text-fg">{connector.name}</span>
          </div>
          <span className="rounded-[4px] border border-line bg-mark px-1.5 py-0.5 text-[9.5px] font-medium tracking-wide text-fg-3 uppercase">
            {connector.category}
          </span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-3">{connector.description}</p>

        {connector.model && (
          <p className="mt-2 flex items-baseline gap-1.5 text-[11px]">
            <span className="text-fg-4">Runs on</span>
            <span className="truncate font-mono text-fg-2" title={connector.model}>
              {connector.model}
            </span>
            {connector.modelProvider && (
              <span className="shrink-0 text-fg-4">· {connector.modelProvider}</span>
            )}
          </p>
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-line/60">
        {!editing ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] text-fg-3">
              <Dot2 tone={running ? 'calm' : needsKey ? 'needs' : 'calm'} />
              {running
                ? 'Connected'
                : needsKey
                  ? `Runs locally — no ${connector.requiresKey}`
                  : 'Ready'}
            </span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setApiKey('')
                setEndpoint(connector.endpoint ?? '')
                setEditing(true)
              }}
            >
              {needsKey ? (running ? 'Change key' : 'Add key') : 'Details'}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={KEY_HINT[connector.id] ?? 'API Key (optional)'}
              className="w-full rounded-[5px] border border-line bg-ink-0 px-2 py-1 text-[11px] text-fg  focus:border-fg-4 focus:outline-none font-mono"
            />
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectionsSheet({
  open,
  onClose,
  state
}: {
  open: boolean
  onClose: () => void
  state: AppState
}): React.JSX.Element {
  const { neatlogs, entire, model, connectors = [] } = state.integrations
  const [, bump] = useState(0)
  const [searchReady, setSearchReady] = useState(false)

  useEffect(() => {
    if (!open) return
    void window.system.searchConfigured().then(setSearchReady)
  }, [open])

  const agentList = connectors.length > 0 ? connectors : FALLBACK_CONNECTORS

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Engines & integrations"
      subtitle="Every engine carries the same real tools, and runs on the model named on its card."
      width={640}
    >
      {/* engines */}
      <div className="border-b border-line pb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10.5px] font-medium tracking-[0.09em] text-fg-3 uppercase">
            Engines
          </span>
          <span className="text-[11px] text-fg-3">Chosen per task, in the composer</span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {agentList.map((c) => (
            <ConnectorCard key={c.id} connector={c} onSaved={() => bump((n) => n + 1)} />
          ))}
        </div>
      </div>

      {/* the model */}
      <div className="border-b border-line py-4">
        <div className="flex items-center gap-2">
          <Dot2 tone={model.connected ? (model.brains ?? []).some((b) => b.ready) ? 'calm' : 'needs' : 'needs'} />
          <h3 className="text-[14px] text-fg">The local model</h3>
          <span className="num ml-auto max-w-[16rem] truncate text-[11px] text-fg-3">
            {model.connected ? model.model : 'not connected'}
          </span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
          This is the model that does the work no engine above can hand off — files, the shell, the
          browser. An engine with a key runs on its own provider instead; one without falls back to
          this, and says so on the task.
        </p>

        {/* The pool, and where each model stands right now.

            A free key's daily ceiling is per model, not per key, so the pool is
            what stops a run dying on a billing boundary. It is shown here
            because "which weights are loaded" is plumbing — but "this one is
            out for another three minutes, and the one after it is already
            working" is the kind of thing you find out by looking, not by
            guessing. */}
        {(model.brains ?? []).length > 1 && (
          <ul className="mt-3 space-y-1">
            {(model.brains ?? []).map((b, i) => (
              <li key={b.id} className="flex items-center gap-2.5 text-[12px]">
                <Dot2 tone={b.ready ? 'calm' : 'off'} />
                <span className={cx('truncate font-mono', b.ready ? 'text-fg-2' : 'text-fg-4')}>
                  {shortModel(b.id)}
                </span>
                {i === 0 && b.ready && (
                  <span className="shrink-0 rounded-[4px] bg-veil px-1.5 py-[1px] text-[10px] text-fg-3">
                    first
                  </span>
                )}
                <span className="num ml-auto shrink-0 text-fg-4">
                  {b.ready ? '' : (b.reason ?? 'over its limit')}
                </span>
              </li>
            ))}
          </ul>
        )}

        <dl className="num mt-3 space-y-1 text-[12px]">
          <Row k="Model" v={model.model} />
          {model.handovers > 0 && (
            <Row
              k="Handovers"
              v={`${model.handovers} this session — each one is in the trace`}
            />
          )}
          <Row k="Injection guard" v={model.guard} />
          <Row k="Web search" v={searchStatus(searchReady)} />
          <Row
            k="Screen filter"
            v="Any page or external tool output is scored for injection defense and sanitized"
          />
        </dl>
        {model.error && (
          <p className="mt-2 rounded-[8px] border border-line bg-mark px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-3">
            {model.error}
          </p>
        )}
      </div>

      {/* neatlogs */}
      <div className="border-b border-line py-4">
        <div className="flex items-center gap-2">
          <Dot2 tone={neatlogs.connected ? 'calm' : neatlogs.installed ? 'needs' : 'off'} />
          <h3 className="text-[14px] text-fg">neatlogs</h3>
          <span className="num ml-auto text-[11px] text-fg-3">
            {neatlogs.connected
              ? `${neatlogs.spansExported} spans exported · ${ago(neatlogs.lastExportAt)}`
              : 'local only'}
          </span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
          Every sentence the agent says is rendered from a trace span. Turn on{' '}
          <Code>NEATLOGS_API_KEY</Code> and the same runs land in your dashboard, tree and all.
        </p>
        {!neatlogs.connected && (
          <p className="mt-2 rounded-[8px] border border-line bg-mark px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-3">
            {neatlogs.error ?? 'Set NEATLOGS_API_KEY in the environment and restart.'}
          </p>
        )}
        <button
          type="button"
          onClick={() => void window.done.openExternal('https://app.neatlogs.com')}
          className="no-drag mt-2.5 inline-flex items-center gap-1.5 text-[12px] text-fg-3 transition-colors hover:text-fg"
        >
          Open neatlogs <I.External className="[&_svg]:h-[12px] [&_svg]:w-[12px]" />
        </button>
      </div>

      {/* Entire */}
      <div className="py-4">
        <div className="flex items-center gap-2">
          <Dot2 tone={entire.enabled ? 'calm' : entire.installed ? 'needs' : 'off'} />
          <h3 className="text-[14px] text-fg">Entire</h3>
          <span className="num ml-auto text-[11px] text-fg-3">
            {entire.version ?? 'not installed'}
          </span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
          A change to how the agent behaves — its limits, the plan it chose after you steered it —
          is written down and committed, so Entire turns it into a checkpoint linked to the session
          that caused it.
        </p>

        <dl className="num mt-3 space-y-1 text-[12px]">
          <Row k="Repository" v={entire.repoPath ?? 'none found'} />
          <Row k="Checkpoints" v={String(entire.checkpoints)} />
          <Row k="Latest" v={entire.lastCheckpointId ?? '—'} />
        </dl>

        {entire.error && (
          <p className="mt-2 rounded-[8px] border border-line bg-mark px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-3">
            {entire.error}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          {!entire.enabled && (
            <Button
              size="sm"
              onClick={async () => {
                const res = await window.system.entireSetup()
                toast(res.message, res.ok, 6000)
                bump((n) => n + 1)
              }}
            >
              Set up checkpointing
            </Button>
          )}
          <Button
            size="sm"
            variant="quiet"
            onClick={async () => {
              await window.system.entireRefresh()
              bump((n) => n + 1)
              toast('Refreshed.')
            }}
          >
            Re-check
          </Button>
          {!entire.installed && (
            <button
              type="button"
              onClick={() => void window.done.openExternal('https://docs.entire.io/installation')}
              className="no-drag ml-auto inline-flex items-center gap-1 text-[11.5px] text-fg-3 transition-colors hover:text-fg"
            >
              Install the CLI <I.External className="[&_svg]:h-[11px] [&_svg]:w-[11px]" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void window.done.revealData()}
            className="no-drag text-[12px] text-fg-3 transition-colors hover:text-fg"
          >
            Show my data on disk
          </button>
          <span className="text-[11px] text-fg-4">·</span>
          <button
            type="button"
            onClick={async () => {
              await window.system.reset()
              toast('Started fresh. All tasks cleared.')
            }}
            className="no-drag text-[12px] text-needs transition-colors hover:opacity-80"
          >
            Start fresh
          </button>
        </div>
        <button
          type="button"
          onClick={() => void window.done.openExternal('https://neatlogs.com/hackathon')}
          className="no-drag inline-flex items-center gap-1.5 text-[12px] text-fg-3 transition-colors hover:text-fg"
        >
          Built for #neatHack <I.External className="[&_svg]:h-[12px] [&_svg]:w-[12px]" />
        </button>
      </div>
    </Sheet>
  )
}

/**
 * What search it will actually use.
 *
 * Shown because a silent search is indistinguishable from a hard task. The
 * version of this app that scraped DuckDuckGo's HTML endpoint reported nothing
 * wrong and returned nothing at all for weeks; the only visible symptom was
 * tasks quietly failing. A status line is the cheapest way to make that
 * impossible to miss again.
 */
function searchStatus(configured: boolean): string {
  if (configured) {
    return 'full web search · Brave or Tavily key found'
  }
  return 'reference only · add BRAVE_SEARCH_API_KEY or TAVILY_API_KEY for the whole web'
}

function Row({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-[92px] shrink-0 text-fg-3">{k}</dt>
      <dd className="min-w-0 flex-1 truncate text-fg-2">{v}</dd>
    </div>
  )
}

function Dot2({ tone }: { tone: 'calm' | 'needs' | 'off' }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'h-[6px] w-[6px] shrink-0 rounded-full',
        tone === 'calm' ? 'bg-calm' : tone === 'needs' ? 'bg-needs' : 'bg-fg-4'
      )}
    />
  )
}
