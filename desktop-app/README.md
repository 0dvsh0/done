# Done. — desktop

**The to-do list that finishes itself.** You write down what you need. An agent does
the work, says what it's doing in plain words, and only interrupts when it truly
needs you.

Electron + React + TypeScript + Tailwind. The agent runtime, the policy engine, the
tracing and the state all live in the **main process**; the renderer only draws what
the main process tells it is true.

---

## Run it

```bash
npm install
npm run dev          # hot-reloading dev window
npm run build        # compile to out/
npm run pack:win     # unpacked build in release/
```

### Environment

| Variable           | What it does                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEATLOGS_API_KEY` | Turns on trace export to [neatlogs](https://neatlogs.com). Without it spans are still recorded locally and shown in the app; they simply aren't uploaded. |
| `DONE_FRESH=1`     | Starts a clean seeded morning instead of restoring your saved list.                                                                                       |
| `DONE_CADENCE=1.6` | Speeds up the demo pacing (`0.5` is frantic, `2` is very slow).                                                                                           |
| `DONE_SHOT=1`      | Walks the app through its states and writes screenshots to `docs/shots`.                                                                                  |

Your list is saved to `app.getPath('userData')/state.json` and restored on launch.
**Settings → Connections → Show my data on disk** opens it.

---

## The idea

> A sentence is finished when it gets its period. So is a task.

One shape carries every state. A task starts as an open circle; a ring fills as work
happens; when it's finished the circle closes into a period — which is also the
wordmark in the title bar.

| State             | Dot                     | Meaning                                              |
| ----------------- | ----------------------- | ---------------------------------------------------- |
| Waiting           | thin outline            | Written down. Starts soon, or when you said.         |
| On it             | ring fills + slow pulse | Working. The ring is how far along.                  |
| Needs you         | amber, beckoning        | **The only attention colour.** Kept rare on purpose. |
| Hit a snag        | coral                   | Something failed. It is already trying another way.  |
| Paused / With you | flat grey               | You stopped it, or took it over.                     |
| Done.             | solid period            | Finished, with a receipt you can check.              |

Colour never decorates. Amber means _needs you_, coral means _snag_, sage means
_reversible_. Everything else is one white at a different opacity on `#09090a`.

Motion is only ever a status: the breathing pulse, the crossfaded sentence, the ring
that closes. Everything respects `prefers-reduced-motion`.

---

## What's in here

```
src/
  shared/types.ts          the only contract between main and renderer
  main/
    index.ts               window, tray, menu, IPC, persistence
    agent.ts               the runtime: tasks, undo, policy, seeding
    scripts.ts             beats — each one is a span and a sentence
    integrations.ts        neatlogs tracing + the Entire CLI bridge
    finance.ts             the cfo.ai unit-economics model
  preload/index.ts         the contextBridge API
  renderer/src/
    App.tsx                layout
    components/            TitleBar, TaskList, Detail, Sheets, TraceSheet, CommandBar…
```

### The agent loop

A task is a sequence of **beats**. A beat is one thing the agent does, and it is
simultaneously:

- a span in the neatlogs trace, and
- the sentence the agent says out loud.

There is no second description of a step. `name`, `input` and `output` become both
the machine line under _Show what's underneath_ and the raw material for the plain
sentence. If the trace is wrong, the sentence is wrong — which is the point.

Each run is a real `trace()` rooted in a `WORKFLOW` span, with `TOOL` / `LLM` /
`RETRIEVER` / `GUARDRAIL` spans nested underneath it. An approval is a `GUARDRAIL`
span, so the moment it stopped to ask you is in the trace too.

### Policy

Limits really change behaviour:

- **Spend up to `$0` / `$25` / `$100` without asking.** At `$25` a `$24` refund goes
  through on its own; a `$120` plumber still asks.
- **Show messages before they're sent.** Turn it off and the gym cancellation is sent
  without you.
- **Never do anything irreversible.** Always asks. This one is not a switch.
- **Quiet hours.** Holds questions overnight.

Anything declined puts the task to sleep rather than throwing the work away — resume
whenever.

### Control

Four verbs, never more than one keystroke away, on every task:

`Pause` · `Steer` · `Take over` · `Undo`

**Steer** is the interesting one. Say "actually, cheaper" or "not Fridays" and the
plan is rewritten mid-stride by a real `llm.replan` span. **Undo** rewinds the live
task object in place, so a running agent rewinds rather than restarting.

### Keyboard

`N` new · `J`/`K` move · `↵` open · `Space` pause · `S` steer · `T` take over ·
`U` show what's underneath · `⌘K` command bar · `⌘T` trace · `⌘↵` approve · `⌘Z` undo ·
`,` limits · `?` shortcuts · `Esc` close

---

## Integrations

### neatlogs

The TypeScript SDK runs in the main process. Every agent step is a span; every trace
is rooted at one task run.

```bash
npx neatlogs doctor --local --json     # verified: status "pass", SDK 1.1.28, schema 2
```

Set `NEATLOGS_API_KEY` and the same spans are exported to your dashboard under the
`done-desktop` workflow. The app never claims an export it didn't make — the status
chip in the bottom bar says _exported_ or _local only_ based on what actually
happened.

### Entire

A change to how the agent behaves — its spending limits, the plan it chose after you
steered it — is written to `.done/behaviour/<timestamp>.json` and committed.
Entire's git hook turns that commit into a checkpoint linked to the session that
caused it.

```bash
entire enable -y --agent opencode      # run once per repo
```

The app detects the CLI, reads `entire checkpoint list --json`, and shows the count
and latest id in **Settings → Connections**. If the CLI isn't on `PATH` it says so
and offers the install command instead of pretending.

### cfo.ai

**Pay per period. Not for effort.** If it didn't get done, it isn't billed — which
only works if the cost of a _finished_ task is known. So the app measures it from the
traces: every span in a completed run, including the calls that failed and the
verification pass. Failed work is ours, not yours.

**Pay per period** in the command bar shows the live model — price, measured cost,
margin, and three scenarios.

---

## Honest limitations

- **The tools are simulated.** Search, browser, email and payments are scripted
  adapters with realistic latency, not live integrations. The loop, the policy, the
  tracing, the recovery and the verification are real; the world it acts on is not.
- **Token counts and costs are estimates** attached to spans, not billed figures.
- **No accounts, no sync, no model calls.** There is no LLM in the loop yet — the
  planner is deterministic. Wiring a real model means replacing
  `src/main/scripts.ts` beats with `llm` spans and a provider client; the trace tree,
  the UI and the policy engine already expect them.
- Spans for steps carried over from a previous session aren't recovered, and the
  trace sheet says so rather than quietly showing a shorter tree.

## Next

1. Swap the scripted beats for a real planner/executor with live tools.
2. Push received approval questions to a tray badge instead of relying on the window.
3. Recurring tasks — the `when` chip is already carried end to end.
