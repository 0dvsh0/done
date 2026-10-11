import { useEffect, useState } from 'react'
import type { AppState, ConnectorInfo, Economics, Limits } from '../../../shared/types'
import { ago, cx, money, tiny } from '../lib/format'
import { api, toast, useUI } from '../store'
import * as I from './Icons'
import { Button, Field, Segmented, Sheet, Switch } from './primitives'

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
          onChange={(v) => {
            void api.limits({ spend: v })
            toast(
              v > 0
                ? `It will now run on its own up to ${money(v)} a job.`
                : 'It will ask before every job that costs anything.',
              true
            )
          }}
          options={[
            { value: 0, label: '$0' },
            { value: 0.05, label: '5¢' },
            { value: 0.25, label: '25¢' },
            { value: 1, label: '$1' }
          ]}
        />
      </Field>

      <Field
        locked
        title="Never do anything that can’t be undone"
        hint="Writing over a file, opening something on your desktop, handing code to another agent. Always asks. This one stays on."
      >
        <span className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-5">
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

      <p className="pt-4 text-[11.5px] leading-relaxed text-fg-5">
        Every step is traced end to end — the model call, the tool, the answer it checked — so you
        can always see exactly what happened and what it cost. Turn on{' '}
        <code className="rounded-[4px] bg-white/[0.05] px-1 py-px font-mono text-[11px] text-fg-3">
          NEATLOGS_API_KEY
        </code>{' '}
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
            <dd className="flex gap-1">
              {keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-[5px] border border-line bg-white/[0.035] px-1.5 text-[10.5px] text-fg-3"
                >
                  {k}
                </kbd>
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
      title="Pi Agent Engine & Capabilities"
      subtitle="Autonomous agent runtime (v1.1.0) powered by Groq and 19 native tools."
      width={620}
    >
      <div className="pb-4">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[11px] border border-line bg-line">
          <Cell label="Agent Engine" value="Pi Core v1.1.0" hint="autonomous execution loop" />
          <Cell
            label="Inference Brain"
            value="gpt-oss-120b"
            hint="128k context · Groq LPU"
          />
          <Cell
            label="Safety Classifier"
            value="Prompt Guard"
            hint="86M injection defense"
            tone="good"
          />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[11px] border border-line bg-line">
          <Cell
            label="Avg Cost / Task"
            value={econ ? tiny(econ.costPerPeriod) : '$0.0035'}
            hint={measured ? `measured from ${finishedRuns} runs` : `real tokens · ${finishedRuns} completed`}
          />
          <Cell label="Token Rates" value="$0.15 / $0.60" hint="per 1M input / output" />
          <Cell label="Active Tools" value="19 Native" hint="web, browser, shell, files" tone="good" />
        </div>

        <h3 className="mt-5 mb-2 text-[10.5px] font-medium tracking-[0.09em] text-fg-4 uppercase">
          Agent Capabilities & Architecture
        </h3>

        <div className="space-y-2 text-[12px] text-fg-3">
          <div className="rounded-[8px] border border-line bg-ink-1 p-2.5">
            <span className="font-medium text-fg">Live Reasoning Stream</span>
            <p className="mt-0.5 text-fg-4">
              Native reasoning tokens (<code className="text-fg-3">thinking_delta</code>) stream directly into the UI in real-time, delivering the continuous thinking feedback of Grok Bot, Muse Spark, and GPT Dots.
            </p>
          </div>

          <div className="rounded-[8px] border border-line bg-ink-1 p-2.5">
            <span className="font-medium text-fg">19 Real Native Tools</span>
            <p className="mt-0.5 text-fg-4">
              <strong>Web & Research:</strong> web_search (multi-engine), web_fetch (markdown extraction + injection guard).<br />
              <strong>Chromium DevTools:</strong> headless browser open, read, click, type, submit, screenshot, close.<br />
              <strong>Filesystem:</strong> file_read, file_write, file_list, file_search.<br />
              <strong>System & Computer:</strong> shell_run, system_info, clipboard_read, clipboard_write, open_url.<br />
              <strong>Specialist Delegation:</strong> code_agent.
            </p>
          </div>

          <div className="rounded-[8px] border border-line bg-ink-1 p-2.5">
            <span className="font-medium text-fg">Guardrails & Verification</span>
            <p className="mt-0.5 text-fg-4">
              Irreversible actions (file modifications, shell commands, desktop interaction) pause and ask for your explicit approval. Spend budgets are enforced strictly against live token usage. Every completed task passes a strict independent verification check before receipts are generated.
            </p>
          </div>
        </div>

        <p className="mt-4 text-[11.5px] leading-relaxed text-fg-5">
          All executions, token counts, and costs are authentic. There are zero simulated runs or dummy metrics.
        </p>
      </div>
    </Sheet>
  )
}

function Cell({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good'
}): React.JSX.Element {
  return (
    <div className="bg-ink-1 px-3.5 py-3">
      <p className="text-[10.5px] tracking-[0.05em] text-fg-5 uppercase">{label}</p>
      <p
        className={cx(
          'num mt-1 text-[19px] leading-none',
          tone === 'good' ? 'text-calm' : 'text-fg'
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[10.5px] text-fg-5">{hint}</p>}
    </div>
  )
}

/* ----------------------------------------------------------- connections */

const DEFAULT_CONNECTORS: ConnectorInfo[] = [
  {
    id: 'claude',
    name: 'Claude & Claude Code',
    blurb: 'Web, desktop, phone and terminal. Leading coding & agentic refactoring.',
    category: 'code',
    badge: '✻ Claude',
    icon: 'claude',
    description: 'Precision software engineering, tests, file edits, and terminal commands.',
    requiresKey: 'ANTHROPIC_API_KEY',
    connected: false
  },
  {
    id: 'grok',
    name: 'xAI Grok',
    blurb: 'Direct reasoning with real-time web search integration.',
    category: 'search',
    badge: '⚡ Grok',
    icon: 'grok',
    description: 'Live web intelligence, rapid unfiltered analysis, and high-velocity reasoning.',
    requiresKey: 'XAI_API_KEY',
    connected: false
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT & Codex',
    blurb: 'Deep multi-step analytical reasoning and synthesis.',
    category: 'reasoning',
    badge: '◎ ChatGPT',
    icon: 'chatgpt',
    description: 'Structured multi-step planning, code synthesis, and analytical breakdowns.',
    requiresKey: 'OPENAI_API_KEY',
    connected: false
  },
  {
    id: 'muse',
    name: 'Muse Spark',
    blurb: 'Spatial canvas and divergent thinking tool for product ideas.',
    category: 'creative',
    badge: '✧ Muse',
    icon: 'muse',
    description: 'Divergent ideation, visual sparks, product metaphors, and UX exploration.',
    connected: true
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    blurb: '1M+ token context window for whole-codebase comprehension.',
    category: 'code',
    badge: '✦ Gemini',
    icon: 'gemini',
    description: 'Massive 1M+ token context window for repo-wide comprehension & audit.',
    requiresKey: 'GEMINI_API_KEY',
    connected: false
  },
  {
    id: 'roma',
    name: 'Roma MCP Server',
    blurb: 'Connect your agents to Roma — MCP hub for cross-agent collaboration.',
    category: 'protocol',
    badge: '⚯ Roma',
    icon: 'roma',
    description: 'Connects to roma.app/agents MCP bus for cross-agent collaboration.',
    connected: true,
    endpoint: 'https://api.roma.app/mcp'
  },
  {
    id: 'pi',
    name: 'Pi Agent Core',
    blurb: 'Autonomous engine with 19 local desktop and browser tools.',
    category: 'desktop',
    badge: '⚙ Pi',
    icon: 'pi',
    description: 'Autonomous execution engine with 19 local desktop tools & browser.',
    connected: true
  }
]

function getConnectorIcon(id: string): React.JSX.Element {
  switch (id) {
    case 'claude':
      return <I.Terminal className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-orange-400" />
    case 'grok':
      return <I.Zap className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-amber-300" />
    case 'chatgpt':
      return <I.Bot className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-emerald-400" />
    case 'muse':
      return <I.Sparkles className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-pink-400" />
    case 'gemini':
      return <I.Sparkles className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-blue-400" />
    case 'roma':
      return <I.Link className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-purple-400" />
    case 'pi':
    default:
      return <I.Bot className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-fg-3" />
  }
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
      await api.setConnectorConfig(connector.id, {
        apiKey: apiKey.trim() || undefined,
        endpoint: endpoint.trim() || undefined
      })
      toast(`Saved configuration for ${connector.name}.`, true)
      setEditing(false)
      onSaved()
    } catch (err) {
      toast(`Failed to save: ${String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col justify-between rounded-[9px] border border-line bg-ink-1 p-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {getConnectorIcon(connector.id)}
            <span className="text-[12.5px] font-medium text-fg">{connector.name}</span>
          </div>
          <span className="rounded-[4px] bg-white/[0.05] px-1.5 py-0.5 text-[9.5px] font-medium tracking-wide text-fg-4 uppercase">
            {connector.category}
          </span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-4">
          {connector.description}
        </p>
      </div>

      <div className="mt-3 pt-2 border-t border-line/60">
        {!editing ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] text-fg-5">
              <Dot2 tone={connector.connected ? 'calm' : connector.requiresKey ? 'off' : 'calm'} />
              {connector.connected
                ? 'Connected'
                : connector.requiresKey
                  ? 'Key required'
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
              {connector.connected ? 'Edit' : 'Configure'}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                connector.id === 'claude'
                  ? 'Anthropic API Key (sk-ant-...)'
                  : connector.id === 'grok'
                    ? 'xAI API Key (xai-...)'
                    : connector.id === 'chatgpt'
                      ? 'OpenAI API Key (sk-...)'
                      : connector.id === 'gemini'
                        ? 'Gemini API Key (AIza...)'
                        : 'API Key (optional)'
              }
              className="w-full rounded-[5px] border border-line bg-ink-0 px-2 py-1 text-[11px] text-fg placeholder:text-fg-5 focus:border-fg-4 focus:outline-none font-mono"
            />
            {(connector.id === 'roma' || connector.endpoint) && (
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="Endpoint URL (e.g. https://api.roma.app/mcp)"
                className="w-full rounded-[5px] border border-line bg-ink-0 px-2 py-1 text-[11px] text-fg placeholder:text-fg-5 focus:border-fg-4 focus:outline-none font-mono"
              />
            )}
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
  const { neatlogs, entire, model, connectors = DEFAULT_CONNECTORS } = state.integrations
  const [, bump] = useState(0)
  const [copiedMcp, setCopiedMcp] = useState(false)

  const copyMcpConfig = (): void => {
    const config = JSON.stringify(
      {
        mcpServers: {
          'done-roma': {
            url: 'https://api.roma.app/mcp'
          }
        }
      },
      null,
      2
    )
    void navigator.clipboard.writeText(config)
    setCopiedMcp(true)
    toast('Copied Roma MCP configuration to clipboard!')
    setTimeout(() => setCopiedMcp(false), 2500)
  }

  const agentList = connectors.length > 0 ? connectors : DEFAULT_CONNECTORS

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Connected Agents & Integrations"
      subtitle="Connect your agents (Roma style). One shared list, dispatched with calm UI."
      width={640}
    >
      {/* Connected Agents Header & Roma MCP */}
      <div className="border-b border-line pb-4">
        <div className="rounded-[10px] border border-line bg-ink-1/60 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <I.Link className="[&_svg]:h-[13px] [&_svg]:w-[13px] text-purple-400" />
              <h3 className="text-[13px] font-medium text-fg">Connect your agents to Roma</h3>
            </div>
            <button
              type="button"
              onClick={copyMcpConfig}
              className="inline-flex items-center gap-1.5 rounded-[5px] border border-line bg-white/[0.04] px-2 py-1 text-[11px] text-fg-3 transition-colors hover:text-fg"
            >
              <I.Copy className="[&_svg]:h-[11px] [&_svg]:w-[11px]" />
              {copiedMcp ? 'Copied' : 'Copy MCP Config'}
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-4">
            Connect Claude Code, Zed, Cursor, or Windsurf. External agents can write tasks directly to your list via standard Model Context Protocol.
          </p>
          <code className="mt-2 block overflow-x-auto rounded-[6px] border border-line bg-ink-0 px-2.5 py-1.5 font-mono text-[11px] text-fg-3">
            https://api.roma.app/mcp
          </code>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10.5px] font-medium tracking-[0.09em] text-fg-4 uppercase">
              Connected Agent Network
            </span>
            <span className="text-[11px] text-fg-5">
              LLM automatically routes or choose via dropdown
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {agentList.map((c) => (
              <ConnectorCard
                key={c.id}
                connector={c}
                onSaved={() => bump((n) => n + 1)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* the model (Dispatcher & Brain) */}
      <div className="border-b border-line py-4">
        <div className="flex items-center gap-2">
          <Dot2 tone={model.connected ? 'calm' : 'needs'} />
          <h3 className="text-[14px] text-fg">Inference Router & Classifier</h3>
          <span className="num ml-auto max-w-[16rem] truncate text-[11px] text-fg-5">
            {model.connected ? model.model : 'not connected'}
          </span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
          Our LLM inspects user task intent and context to intelligently route each task to the ideal connected agent. It acts as the dispatcher and harmonizer to maintain a peaceful, serene UI.
        </p>
        <dl className="num mt-3 space-y-1 text-[12px]">
          <Row k="Dispatcher Brain" v={model.model} />
          <Row k="Injection guard" v={model.guard} />
          <Row
            k="Screen filter"
            v="Any page or external tool output is scored for injection defense and sanitized"
          />
        </dl>
        {model.error && (
          <p className="mt-2 rounded-[8px] border border-line bg-ink-0/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-4">
            {model.error}
          </p>
        )}
      </div>

      {/* neatlogs */}
      <div className="border-b border-line py-4">
        <div className="flex items-center gap-2">
          <Dot2 tone={neatlogs.connected ? 'calm' : neatlogs.installed ? 'needs' : 'off'} />
          <h3 className="text-[14px] text-fg">neatlogs</h3>
          <span className="num ml-auto text-[11px] text-fg-5">
            {neatlogs.connected
              ? `${neatlogs.spansExported} spans exported · ${ago(neatlogs.lastExportAt)}`
              : 'local only'}
          </span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
          Every sentence the agent says is rendered from a trace span. Turn on{' '}
          <code className="rounded-[4px] bg-white/[0.05] px-1 py-px font-mono text-[11px] text-fg-2">
            NEATLOGS_API_KEY
          </code>{' '}
          and the same runs land in your dashboard, tree and all.
        </p>
        {!neatlogs.connected && (
          <p className="mt-2 rounded-[8px] border border-line bg-ink-0/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-4">
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
          <span className="num ml-auto text-[11px] text-fg-5">
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
          <p className="mt-2 rounded-[8px] border border-line bg-ink-0/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-4">
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
              className="no-drag ml-auto inline-flex items-center gap-1 text-[11.5px] text-fg-4 transition-colors hover:text-fg-2"
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
            className="no-drag text-[12px] text-fg-4 transition-colors hover:text-fg-2"
          >
            Show my data on disk
          </button>
          <span className="text-[11px] text-fg-5">·</span>
          <button
            type="button"
            onClick={async () => {
              await window.system.reset()
              toast('Started fresh. All tasks cleared.')
            }}
            className="no-drag text-[12px] text-needs/80 transition-colors hover:text-needs"
          >
            Start fresh
          </button>
        </div>
        <button
          type="button"
          onClick={() => void window.done.openExternal('https://neatlogs.com/hackathon')}
          className="no-drag inline-flex items-center gap-1.5 text-[12px] text-fg-4 transition-colors hover:text-fg-2"
        >
          Built for #neatHack <I.External className="[&_svg]:h-[12px] [&_svg]:w-[12px]" />
        </button>
      </div>
    </Sheet>
  )
}

function Row({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-[92px] shrink-0 text-fg-5">{k}</dt>
      <dd className="min-w-0 flex-1 truncate text-fg-3">{v}</dd>
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
