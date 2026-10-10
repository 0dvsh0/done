# Done.

**The to‑do list that finishes itself.** You write down what you need. An agent does the work, describes what it's doing in plain words, and only interrupts when it truly needs you.

Built for **#neatHack** (neatlogs AI agent hackathon, Oct 10–11 2026). The only track is *"Build an agent that works (literally)."*

---

## The design idea

> A sentence is finished when it gets its period. So is a task.

The interface uses one shape for everything: **the dot**. Every task starts as an open circle. A ring fills it as work happens, and when the task is finished the circle closes into a solid period. The wordmark `done.` is that same period.

| State | Dot | Meaning |
|---|---|---|
| Waiting | thin outline | Written down, starts soon |
| On it | ring fills + slow pulse | Working; the ring shows how far along it is |
| Needs you | amber | **The only attention colour.** Kept rare on purpose |
| Hit a snag | coral | Something failed and it's already trying another way |
| Done | solid period | Finished, with a receipt |

Design rules:
- **Colour carries meaning, not decoration.** Amber means "needs you", coral means "snag", sage means "safe/reversible". Everything else is one white at different opacities on `#09090a`.
- **One voice.** The agent speaks in first-person plain sentences. Technical detail sits under "Show what's underneath".
- **Calm motion.** Everything that moves is a status: the breathing pulse, the crossfaded sentence, the single ring when a task completes. Respects `prefers-reduced-motion`.
- **Typography:** Geist for the interface, Instrument Serif for the voice (headlines, the agent's current sentence).

## Pages / entry points

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `app.html` | Interactive demo of the app (simulated agent, UI only) |
| `app.html?t=<task>` | Opens the demo with that task already handed off (the landing page's final input uses this) |

## Landing page sections
1. **Hero:** headline whose period is a live dot, plus a list that plays itself (tasks progress, one hits a snag, one asks for approval, a new one gets typed in).
2. **Manifesto:** the period metaphor.
3. **One shape. Five meanings.:** the state system.
4. **It talks like a person:** narration with a "Show what's underneath" switch that shows the trace line under each sentence.
5. **It asks before it spends, sends, or signs:** a working approval card.
6. **When something breaks:** a recovery timeline that lights up as you scroll to it.
7. **Four words. Total control.:** Pause · Steer · Take over · Undo.
8. **Every period comes with a receipt:** proof, cost, and how to reverse it.
9. **Pricing:** pay per finished task ("Pay for periods. Not for effort.").
10. **Made in the open:** what neatlogs, Entire and cfo.ai each do in the product.
11. **Final CTA:** type a task and hand it off into the demo.

## Demo features (`app.html`)
- **Composer:** write a task. Optional chips (*By when*, *Up to $*, *Ask me…*) appear only while you type.
- **Groups:** *Needs you* (only when something does), *Going*, *Done today* (can be collapsed).
- **Live simulated agent:** each task runs through scripted steps at a human pace, with plain-language status, progress, snags and recovery.
- **Needs‑you cards:** approve/decline, choose between options, and review a draft message before it's sent.
- **Controls on every task:** Pause/Resume, Steer (add an instruction mid-task, which updates the plan), Take over/Hand back, Stop.
- **Undo** from the toast or with ⌘Z. Done tasks with a reversible receipt can be reversed.
- **Pause all**, for when you want everything to stop.
- **Limits:** auto-approve spending under $0 / $25 / $100, require review of messages, an "irreversible actions always ask" rule that's locked on, and quiet hours. Limits really change agent behaviour: for example, set $100 and the dinner grocery order goes through on its own.
- **Detail panel:** the current sentence, the plan with the current step, the full story (newest first), the "Show what's underneath" trace lines, and a receipt with proof chips.
- **Ledger:** "Spent $X today, all approved by you · Saved you about N minutes."
- **Keyboard:** `N` new · `J/K` move · `↵` open · `Space` pause · `S` steer · `T` take over · `⌘Z` undo · `Esc` close · `?` shortcuts.
- Responsive: the detail panel becomes a full-screen sheet on phones.

## Data & storage
None yet. It's a UI demo, and all state lives in memory in `js/app.js`. Each task is `{ id, title, state, progress, line, planIdx, story[], ask, receipt, notes[] }`, and it's driven by step scripts (`SCRIPTS`) plus a generic script generator for tasks you type in.

## File structure
```
index.html        landing
app.html          demo
css/base.css      tokens, dot system, buttons, grain
css/landing.css   landing layout
css/app.css       app layout
js/landing.js     hero simulation, reveals, interactive cards
js/app.js         agent simulation engine + UI
```

## Not yet implemented
- A real agent backend (planner, tools, browser, email, payments). This needs a server and can't run in a static site.
- Real neatlogs tracing: the "underneath" lines are illustrative examples.
- Accounts, saving tasks between sessions, notifications, a shared household list.

## How this maps to the neatHack judging criteria
| Criterion (weight) | Plan |
|---|---|
| **The agent (30%)** | A planner/executor that runs on a goal → plan → tool → result → next step loop, with built-in **verification** before it says "done" (receipt) and visible **recovery** (snag → another way). |
| **neatlogs, Entire, cfo.ai (25%)** | **neatlogs**: every user-facing sentence is generated *from* a trace span, so the product literally depends on the traces. Show before/after traces for each fix. **Entire**: checkpoints on every agent-behaviour commit. **cfo.ai**: pay-per-done pricing model (cost per finished task, margins, runway). |
| **Demo video (20%)** | Under 3 minutes: landing hero → type a task → the agent works → snag → approval → "Done." with receipt → flip "Show what's underneath" to the neatlogs trace → Entire checkpoint → cfo.ai sheet. |
| **Building in public (15%)** | Post the dot state system, the "underneath" switch and the receipt as short clips tagged #neatHack. |
| **Usefulness & originality (10%)** | A to-do list where *completion is the product*, and *pay per period*. |

## Next steps
1. Build the real agent loop (e.g. on Amazon Bedrock) with tools for search, browser, email and calendar, and connect it to this UI's event shape (`line`, `code`, `tone`, `ask`).
2. Instrument with the neatlogs SDK. Generate `line` from span data and show the trace link under "Show what's underneath".
3. Add the approval policy engine (limits → auto-approve or ask), with irreversible actions hard-locked to "ask".
4. Store tasks with the Table API or a backend, and add push notifications that fire only for "Needs you".
5. Record the demo video and publish the build-in-public posts.

## Deploy
Use the **Publish tab** to put the site live.
