import { useEffect, useState } from 'react'
import type { AppState, Economics, Limits } from '../../../shared/types'
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
      <BusinessSheet open={sheet === 'business'} onClose={close} state={state} />
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
      <Field title="Spend without asking" hint="Anything above this comes to you first.">
        <Segmented
          ariaLabel="Spend without asking"
          value={limits.spend}
          onChange={(v) => {
            void api.limits({ spend: v })
            toast(
              v > 0
                ? `It can now spend up to ${money(v)} on its own.`
                : 'It will ask about every cent.',
              true
            )
          }}
          options={[
            { value: 0, label: '$0' },
            { value: 25, label: '$25' },
            { value: 100, label: '$100' }
          ]}
        />
      </Field>

      <Field
        title="Show me messages before they’re sent"
        hint="Emails, texts and forms written in your name."
      >
        <Switch
          checked={limits.messages}
          label="Show me messages before they’re sent"
          onChange={(v) => void api.limits({ messages: v })}
        />
      </Field>

      <Field
        locked
        title="Never do anything that can’t be undone"
        hint="Cancelling, deleting, signing. Always asks. This one stays on."
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
        Every step is traced end to end, so you can always see exactly what happened and why —
        including the things it did without asking.
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

/* -------------------------------------------------------------- business */

function BusinessSheet({
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

  const measured =
    Object.values(state.spans).filter((s) => s.some((x) => x.name === 'task_complete')).length > 2

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pay per period. Not for effort."
      subtitle="If it didn’t get done, it doesn’t count. Planned in cfo.ai, measured from the traces."
      width={600}
    >
      {!econ ? (
        <p className="py-6 text-center text-[13px] text-fg-4">Working it out…</p>
      ) : (
        <div className="pb-4">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[11px] border border-line bg-line">
            <Cell label="Price per period" value={money(econ.pricePerPeriod)} />
            <Cell
              label="Cost per period"
              value={tiny(econ.costPerPeriod)}
              hint={measured ? 'measured' : 'assumed'}
            />
            <Cell
              label="Gross margin"
              value={`${econ.marginPct}%`}
              tone={econ.marginPct > 60 ? 'good' : undefined}
            />
          </div>

          <p className="mt-3 text-[12px] leading-relaxed text-fg-4">
            The cost figure is every span in a finished run — planning, retries, the calls that
            failed and the verification pass. Failed work is ours, not yours, which is the only way
            this price can stay honest.
          </p>

          <h3 className="mt-5 mb-2 text-[10.5px] font-medium tracking-[0.09em] text-fg-4 uppercase">
            Scenarios
          </h3>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] tracking-[0.06em] text-fg-5 uppercase">
                <th className="py-1.5 font-medium">Scenario</th>
                <th className="py-1.5 text-right font-medium">Periods</th>
                <th className="py-1.5 text-right font-medium">Revenue</th>
                <th className="py-1.5 text-right font-medium">Costs</th>
                <th className="py-1.5 text-right font-medium">Gross</th>
                <th className="py-1.5 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="num">
              {econ.scenarios.map((s) => (
                <tr key={s.name} className="border-b border-line/60 last:border-b-0">
                  <td className="py-2 text-fg-2">{s.name}</td>
                  <td className="py-2 text-right text-fg-3">{s.customers}</td>
                  <td className="py-2 text-right text-fg-2">{money(s.revenue)}</td>
                  <td className="py-2 text-right text-fg-3">{money(s.cost)}</td>
                  <td className="py-2 text-right text-fg-2">{money(s.gross)}</td>
                  <td
                    className={cx(
                      'py-2 text-right',
                      s.margin >= 70 ? 'text-calm' : s.margin >= 40 ? 'text-fg-2' : 'text-needs'
                    )}
                  >
                    {s.margin}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-4 text-[11.5px] text-fg-5">
            {econ.runwayMonths === Infinity
              ? 'Profitable from the first month, so runway is a decision rather than a deadline.'
              : `At today's unit economics the current plan runs for about ${econ.runwayMonths} months.`}{' '}
            Modelled in{' '}
            <button
              type="button"
              onClick={() => void window.done.openExternal('https://cfo.ai/neathacks')}
              className="inline-flex items-center gap-1 text-fg-3 underline decoration-line-2 underline-offset-2 transition-colors hover:text-fg"
            >
              cfo.ai
              <I.External className="[&_svg]:h-[11px] [&_svg]:w-[11px]" />
            </button>
            .
          </p>
        </div>
      )}
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

function ConnectionsSheet({
  open,
  onClose,
  state
}: {
  open: boolean
  onClose: () => void
  state: AppState
}): React.JSX.Element {
  const { neatlogs, entire } = state.integrations
  const [, bump] = useState(0)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Connections"
      subtitle="What this app is built on, and what it is currently talking to."
      width={580}
    >
      {/* neatlogs */}
      <div className="border-b border-line py-4 first:pt-0">
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
        <button
          type="button"
          onClick={() => void window.done.revealData()}
          className="no-drag text-[12px] text-fg-4 transition-colors hover:text-fg-2"
        >
          Show my data on disk
        </button>
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
