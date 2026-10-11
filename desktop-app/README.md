# Done. — desktop

**The to-do list that actually does things.** You write down what you need. An agent plans it,
picks its own tools, drives a real browser and a real shell, narrates each step in plain words,
and stops to ask before anything it cannot take back.

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

Put a `.env` at the repo root, or anywhere above this folder — the app walks up looking
for one. It can also live in `~/.done/.env`.

| Variable | What it does |
| --- | --- |
| `LLM_API_KEY` | **Required.** A Groq key. Without it the app opens, says it has no brain, and refuses to fake progress. |
| `NEATLOGS_API_KEY` | Turns on trace export to [neatlogs](https://neatlogs.com). Without it spans are still recorded locally and shown in the app; they simply aren't uploaded. |
| `DONE_MODEL` | Override the brain. Default `openai/gpt-oss-120b`. |
| `DONE_GUARD_MODEL` | Override the injection classifier. Default `meta-llama/llama-prompt-guard-2-86m`. |
| `DONE_CODE_MODEL` | Model passed through to the `opencode` CLI when `code_agent` runs. |
| `DONE_FRESH=1` | Ignore the saved list and start empty. |
| `DONE_DEBUG=1` | Print every model prompt and reply to stderr. |
| `DONE_SHOT=1` | Drive a real task through the UI and write screenshots to `docs/shots`. |

Your list is saved to `app.getPath('userData')/state.json` and restored on launch.
**Settings → Connections → Show my data on disk** opens it.

---

## Testing the loop

There is a second entry point, `src/main/harness.ts`, that runs the same `Store`, the
same model and the same tools with no window in the way and prints the trace:

```bash
npm run build
DONE_LIMITS='{"spend":1}' DONE_AUTO=yes npx electron out/main/harness.js "your goal here"
```

It reports the spans, the token counts, the real cost and whether verification passed.
Leave `DONE_AUTO` off and the run **stops and waits** at the first thing it cannot take
back — which is the product's promise, so the harness will not fake an answer.

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
  shared/types.ts          the contract between main and renderer (connectors, tasks, traces)
  main/
    index.ts               window, tray, menu, IPC, persistence
    agent.ts               the 2-phase loop: route → dispatch → execute → verify
    connectors/            Connected Agents Network (Roma style):
      router.ts            LLM Dispatcher Brain & context enricher
      registry.ts          connectors registry & dynamic configuration
      claude.ts            Claude & Claude Code (coding & terminal)
      grok.ts              xAI Grok (real-time web intelligence)
      chatgpt.ts           ChatGPT & Codex (deep reasoning & math)
      muse.ts              Muse Spark (creative ideation & visual sparks)
      gemini.ts            Gemini CLI (1M+ token whole-repo context)
      roma.ts              Roma MCP Server (api.roma.app/mcp bus)
      pi.ts                Pi Agent Core (19 native desktop tools)
    pi.ts                  @earendil-works/pi-agent-core & @earendil-works/pi-ai runtime
    tools/                 the nineteen real tools
    integrations.ts        neatlogs tracing + the Entire CLI bridge
    finance.ts             the cfo.ai unit-economics model
  preload/index.ts         the contextBridge API
  renderer/src/
    App.tsx                layout
    components/            TitleBar, TaskList, Detail, Sheets (Connected Agents Grid), CommandBar…
```

### Connected Agents & Intelligent Routing (Roma Style)

We don't force a single monolithic LLM to execute every task. Following the paradigm of **Roma** ([roma.app/agents](https://roma.app/agents)), Done acts as a shared list and intelligent coordinator across specialized connected agents:

1. **The LLM as Intelligent Router & UI Harmonizer:**
   - Evaluates the user's task prompt, deadline, budget, and local repository context.
   - Intelligently chooses the best connector (or honors manual user selection from the `Via` picker):
     - **Claude Code**: Multi-file refactoring, code editing, terminal commands, test suites.
     - **xAI Grok**: Live web intelligence, breaking trends, rapid unfiltered analysis.
     - **ChatGPT & Codex**: Structured multi-step reasoning, mathematical deduction, analytical synthesis.
     - **Muse Spark**: Divergent creative ideation, product metaphors, UX naming.
     - **Gemini CLI**: Whole-codebase comprehension across 1M+ tokens.
     - **Roma MCP Server**: Universal Model Context Protocol sync (`https://api.roma.app/mcp`) for cross-agent task buses.
     - **Pi Agent Core**: Local desktop tools (Chromium DevTools, shell, clipboard, file system).
   - Generates trace spans (`router.dispatch`) explaining *why* the task was routed to that agent.
   - Cleans up and harmonizes execution output so the user enjoys a serene, peaceful UI without raw JSON clutter.

2. **The Execution & Verification Loop:**
   - The selected connector executes with live streaming tokens (`thought` and `story`).
   - Every reversible and irreversible action honors the user's spending limits and approval guards.
   - Strict independent verification confirms evidence against the user goal before completing and sealing a verified receipt.

### Policy

Limits really change behaviour:

- **Run on its own until it costs `$0` / `5¢` / `25¢` / `$1`.** This is real money:
  every model call returns its token count and cost is computed at Groq's published
  rates. At `$0` it stops and asks before the first call costs anything.
- **Never do anything irreversible.** Always asks. This one is not a switch.
- **Quiet hours.** Holds questions overnight.

Anything declined puts the task to sleep rather than throwing the work away — resume
whenever. Steering a stopped task starts it again with your instruction as context.

### Control

Four verbs, never more than one keystroke away, on every task:

`Pause` · `Steer` · `Take over` · `Undo`

**Steer** is the interesting one. Say "actually, cheaper" or "not Fridays" and the
next decision honours it. **Undo** rewinds the live task object in place, so a
running agent rewinds rather than restarting.

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

- **A 120B model is not infallible.** It will occasionally chase a dead end. The loop
  bounds that — a turn cap, refusal to re-run a call that already failed when nothing
  has changed, and a verification pass before anything is called done — rather than
  pretending it does not happen.
- **The coding agent is delegated.** `code_agent` shells out to the real `opencode`
  CLI. This app does not implement a coding agent of its own.
- **The browser needs a desktop session.** It is a real hidden Chromium window driven
  through the DevTools protocol, so it needs a machine with a display — no headless CI.
- **One machine, one person.** No accounts, no sync, no shared list. The sandbox is
  your home folder and this project, not a container.
- **Free-tier quota is the binding constraint**, not model quality. Runs are tens of
  seconds and occasionally wait out a per-minute token limit. Retries honour the delay
  the provider asks for.
- **Token counts are real; billed cost is list price.** The counts are what the
  provider returned, priced at its published per-million rates. On a free tier that
  overstates what you actually paid, which is the conservative direction for a margin
  model.
- Spans for steps carried over from a previous session aren't recovered, and the
  trace sheet says so rather than quietly showing a shorter tree.

## Next

1. Tray badge for pending approvals, so the app can be trusted in the background.
2. Recurring tasks — the `when` chip is already carried end to end.
3. Per-tool cost hints, so the spend cap can cover paid APIs as well as model calls.
