import type { AskChoice, Receipt, SpanKind, SpanStatus } from '../shared/types'

/**
 * A beat is one thing the agent does. It is simultaneously:
 *
 *   • a span in the neatlogs trace, and
 *   • the sentence the agent says out loud.
 *
 * There is no second description of the step. `name`, `input` and `output`
 * become both the machine line under "show what's underneath" and the raw
 * material for the plain sentence. If the trace is wrong, the sentence is
 * wrong — which is the point.
 */
export interface AskSpec {
  kind: 'approve' | 'choice'
  category?: 'spend' | 'message' | 'action'
  cost?: number
  q: string
  draft?: string
  facts?: [string, string][]
  choices?: AskChoice[]
  none?: string
  yes?: string
  no?: string
}

export interface Beat {
  /** Index into the plan this beat advances to. */
  plan?: number
  /** Progress 0–1 after this beat. */
  p?: number
  kind: SpanKind
  name: string
  input: string
  output: string
  status?: SpanStatus
  tokens?: [number, number]
  cost?: number
  /** The sentence, in plain words. `{x}` is filled from the task's vars. */
  line: string
  vars?: Record<string, string>
  ask?: AskSpec
  done?: boolean
  tone?: 'snag'
  minutes?: number
  receipt?: Omit<Receipt, 'tookMinutes'>
}

export interface Script {
  key: string
  title: string
  plan: string[]
  beats: Beat[]
}

const S = (
  key: string,
  title: string,
  plan: string[],
  beats: Beat[]
): Script => ({ key, title, plan, beats })

/* ------------------------------------------------------------------------ */

const plumber = S(
  'plumber',
  'Find a plumber for the kitchen sink',
  [
    'Find plumbers nearby with good reviews',
    'Check who can come tomorrow',
    'Compare price, rating and speed',
    'Book the one you pick',
    'Check the booking really happened'
  ],
  [
    {
      plan: 0,
      p: 0.1,
      kind: 'TOOL',
      name: 'search_places',
      input: 'q="plumber", near="home", radius=5km',
      output: '14 results',
      line: 'Looking for plumbers near you with good reviews.'
    },
    {
      plan: 1,
      p: 0.22,
      kind: 'LLM',
      name: 'rank',
      input: 'min_rating=4.6, top_k=10',
      output: '6 kept',
      tokens: [312, 76],
      cost: 0.0004,
      line: 'Six have strong reviews. Checking who can come tomorrow.'
    },
    {
      p: 0.3,
      kind: 'TOOL',
      name: 'open_site',
      input: 'rapidflow.com/book',
      output: '503 Service Unavailable',
      status: 'error',
      tone: 'snag',
      line: "One booking site wouldn't load. Calling their number instead."
    },
    {
      p: 0.42,
      kind: 'TOOL',
      name: 'call_place',
      input: 'northside = +1 555 0148',
      output: '3 slots tomorrow, 9:00–12:00',
      status: 'recovered',
      line: 'Got through. Three can come tomorrow morning.'
    },
    {
      plan: 2,
      p: 0.56,
      kind: 'LLM',
      name: 'compare',
      input: 'quotes=3, criteria=[price, rating, eta]',
      output: '2 worth putting in front of you',
      tokens: [498, 64],
      cost: 0.0006,
      line: 'Comparing price, rating and how fast they can get there.'
    },
    {
      p: 0.66,
      kind: 'GUARDRAIL',
      name: 'requires_choice',
      input: 'spend > limit → ask',
      output: 'paused for you',
      line: 'Two good options. Which do you prefer?',
      ask: {
        kind: 'choice',
        q: 'Two good options for tomorrow. Which one?',
        choices: [
          {
            value: 'north',
            label: 'Northside Plumbing at 9am',
            note: '$120 · 4.9 stars · 14 min away',
            cost: 120
          },
          {
            value: 'rapid',
            label: 'Rapidflow at 11:30am',
            note: '$95 · 4.7 stars · 22 min away',
            cost: 95
          }
        ],
        none: 'Neither, keep looking'
      }
    },
    {
      plan: 3,
      p: 0.8,
      kind: 'TOOL',
      name: 'book',
      input: 'provider={choiceKey}',
      output: 'confirmation #PL-2291',
      line: 'Booking {choice}.'
    },
    {
      plan: 4,
      p: 0.9,
      kind: 'GUARDRAIL',
      name: 'verify',
      input: 'check="confirmation matches what I booked"',
      output: 'matched on date, time and address',
      line: 'Checking the confirmation actually says tomorrow, 9am.'
    },
    {
      kind: 'TOOL',
      name: 'calendar_create',
      input: 'event="Plumber — Northside"',
      output: 'added',
      line: 'It’s on your calendar now.',
      p: 0.95
    },
    {
      done: true,
      kind: 'CHAIN',
      name: 'task_complete',
      input: 'goal="kitchen sink"',
      output: 'verified',
      line: 'Booked. {choice}. You’ll sleep better tonight.',
      minutes: 35,
      receipt: {
        lines: [
          ['Booked', '{choice}'],
          ['Cost', '{cost} · pay on arrival'],
          ['Checked', 'Confirmation matches the booking']
        ],
        proof: ['booking confirmation #PL-2291', 'calendar event'],
        undo: 'Free cancellation until tonight'
      }
    }
  ]
)

const gym = S(
  'gym',
  'Cancel the gym membership I don’t use',
  [
    'Find the membership',
    'Work out how to cancel',
    'Write the request in your voice',
    'Send it once you approve',
    'Confirm it really cancelled'
  ],
  [
    {
      plan: 0,
      p: 0.12,
      kind: 'TOOL',
      name: 'email_search',
      input: 'from="ironworks"',
      output: 'membership #44821',
      line: 'Found your Ironworks Gym membership.'
    },
    {
      plan: 1,
      p: 0.22,
      kind: 'TOOL',
      name: 'browser_login',
      input: 'ironworks.gym/account',
      output: 'signed in',
      line: 'Signing in to your gym account.'
    },
    {
      p: 0.3,
      kind: 'TOOL',
      name: 'dom_find',
      input: 'label="Cancel membership"',
      output: 'not found',
      status: 'error',
      tone: 'snag',
      line: 'The cancel button is hidden for online accounts. Trying another way.'
    },
    {
      p: 0.44,
      kind: 'RETRIEVER',
      name: 'read_terms',
      input: 'terms.pdf §7',
      output: '"written notice accepted"',
      status: 'recovered',
      line: 'Their terms say a written request works.'
    },
    {
      plan: 2,
      p: 0.56,
      kind: 'LLM',
      name: 'draft',
      input: 'tone="plain, yours", facts=[membership, §7]',
      output: '94 words',
      tokens: [180, 94],
      cost: 0.0002,
      line: 'Drafted it in your voice so it doesn’t sound like a robot.'
    },
    {
      p: 0.66,
      kind: 'GUARDRAIL',
      name: 'requires_approval',
      input: 'type=message, irreversible=true',
      output: 'paused',
      line: 'Ready to send your cancellation. Waiting for your okay.',
      ask: {
        kind: 'approve',
        category: 'message',
        q: 'Send this cancellation to Ironworks Gym?',
        draft:
          'Hi,\n\nPlease cancel membership #44821, effective today, as allowed by section 7 of your terms.\n\nPlease confirm by email.\n\nThanks,\nAlex',
        facts: [
          ['To', 'members@ironworks.gym'],
          ["You'll save", '$39 a month · $468 a year']
        ],
        yes: 'Send it',
        no: 'Not yet'
      }
    },
    {
      plan: 3,
      p: 0.76,
      kind: 'TOOL',
      name: 'email_send',
      input: 'to="members@ironworks.gym"',
      output: '250 OK',
      line: 'Sent. Waiting for them to reply.'
    },
    {
      plan: 4,
      p: 0.88,
      kind: 'LLM',
      name: 'verify',
      input: 'expect="cancelled"',
      output: 'confirmed in their reply',
      tokens: [420, 22],
      cost: 0.0005,
      line: 'They replied. Checking it really says cancelled.'
    },
    {
      done: true,
      kind: 'CHAIN',
      name: 'task_complete',
      input: 'goal="cancel membership"',
      output: 'verified',
      line: 'Cancelled. You’ll save $39 a month.',
      minutes: 50,
      receipt: {
        lines: [
          ['What changed', 'Membership #44821 cancelled'],
          ['You save', '$39 a month'],
          ['Checked', "Their reply confirms it's cancelled"]
        ],
        proof: ['their reply', 'your request'],
        undo: null
      }
    }
  ]
)

const refund = S(
  'refund',
  'Get a refund for the cracked phone case',
  [
    'Find the order',
    'Check the return rules',
    'Start the return',
    'Confirm the refund amount'
  ],
  [
    {
      plan: 0,
      p: 0.2,
      kind: 'TOOL',
      name: 'email_search',
      input: 'q="phone case"',
      output: 'order #112-4471, 14 March',
      line: 'Found the order from March 14.'
    },
    {
      plan: 1,
      p: 0.4,
      kind: 'TOOL',
      name: 'order_policy',
      input: 'order=#112-4471',
      output: 'within 30 days · eligible',
      line: 'It qualifies for a full refund.'
    },
    {
      plan: 2,
      p: 0.64,
      kind: 'TOOL',
      name: 'return_create',
      input: 'order=#112-4471, reason="cracked"',
      output: 'label.pdf · free drop-off',
      line: 'Started the return. Label saved to your files.'
    },
    {
      plan: 3,
      p: 0.86,
      kind: 'GUARDRAIL',
      name: 'verify',
      input: 'check="refund == amount paid"',
      output: 'refund $24.00 == paid $24.00',
      line: 'Checking the refund matches what you actually paid.'
    },
    {
      done: true,
      kind: 'CHAIN',
      name: 'task_complete',
      input: 'goal="refund"',
      output: 'verified',
      line: 'Refund of $24 is on its way.',
      minutes: 15,
      receipt: {
        lines: [
          ['Refund', '$24.00 to your card'],
          ['Arrives', 'In 3–5 days'],
          ['Checked', 'Refund matches what you paid']
        ],
        proof: ['return label.pdf', 'refund email'],
        undo: 'Cancel the return before drop-off'
      }
    }
  ]
)

const dinner = S(
  'dinner',
  'Plan Saturday dinner for six, one vegetarian',
  [
    'Pick a menu for six',
    'Make sure it works for a vegetarian',
    'Build the grocery list',
    'Order once you approve',
    'Check the delivery slot'
  ],
  [
    {
      plan: 0,
      p: 0.14,
      kind: 'LLM',
      name: 'plan_menu',
      input: 'guests=6, diet=[vegetarian:1]',
      output: '3 menus',
      tokens: [520, 100],
      cost: 0.0007,
      line: 'Finding a menu for six, with one vegetarian.'
    },
    {
      plan: 1,
      p: 0.3,
      kind: 'LLM',
      name: 'check_constraints',
      input: 'menu=risotto+salad+tart',
      output: 'pass',
      tokens: [280, 18],
      cost: 0.0003,
      line: 'Mushroom risotto, a big salad, lemon tart. All vegetarian.'
    },
    {
      plan: 2,
      p: 0.5,
      kind: 'TOOL',
      name: 'pantry_diff',
      input: 'menu=[risotto, salad, tart]',
      output: '14 items needed',
      line: 'Building the grocery list from what you don’t already have.'
    },
    {
      p: 0.64,
      kind: 'GUARDRAIL',
      name: 'requires_approval',
      input: 'spend=$64.20 > limit',
      output: 'paused',
      line: 'Groceries are ready to order. Waiting for your okay.',
      ask: {
        kind: 'approve',
        category: 'spend',
        cost: 64.2,
        q: 'Order the groceries for Saturday morning?',
        facts: [
          ['Total', '$64.20 · 14 items'],
          ['Delivery', 'Saturday, 9–10am'],
          ['If you say no', "I'll send you the list instead"]
        ],
        yes: 'Order',
        no: "I'll shop myself"
      }
    },
    {
      plan: 3,
      p: 0.8,
      kind: 'TOOL',
      name: 'checkout',
      input: 'cart=14 items',
      output: 'order #G-8812',
      line: 'Ordered. Delivery is Saturday, 9–10am.'
    },
    {
      plan: 4,
      p: 0.92,
      kind: 'GUARDRAIL',
      name: 'verify',
      input: 'check="slot confirmed"',
      output: 'confirmed for Sat 9–10am',
      line: 'Checking the delivery slot is actually held for you.'
    },
    {
      done: true,
      kind: 'CHAIN',
      name: 'task_complete',
      input: 'goal="dinner for six"',
      output: 'verified',
      line: 'Dinner’s sorted. Groceries arrive Saturday morning.',
      minutes: 45,
      receipt: {
        lines: [
          ['Menu', 'Risotto, salad, lemon tart'],
          ['Groceries', '$64.20 · arriving Sat 9–10am'],
          ['Checked', 'Slot confirmed by the store']
        ],
        proof: ['recipe cards', 'order receipt #G-8812'],
        undo: 'Cancel the order until Friday 8pm'
      }
    }
  ]
)

export const SCRIPTS: Record<string, Script> = {
  plumber,
  gym,
  refund,
  dinner
}

/* ------------------------------------------------------- the generic case */

const NEEDS_APPROVAL =
  /\b(book|buy|order|pay|send|email|cancel|sign|reserve|schedule|call|text|hire|renew|subscribe|apply|transfer|return|delete|upgrade|ship)\b/i

const quote = (s: string): string => s.replace(/"/g, "'")

/**
 * Anything you type gets a real plan built from it: read the goal, look at
 * options, narrow, act, then verify. No task ever finishes without a check.
 */
export function genericScript(title: string): Script {
  const short = title.length > 46 ? `${title.slice(0, 44).trim()}…` : title
  const asks = NEEDS_APPROVAL.test(title)
  const s = quote(short)

  const beats: Beat[] = [
    {
      plan: 0,
      p: 0.12,
      kind: 'LLM',
      name: 'parse_goal',
      input: `goal="${s}"`,
      output: '4 steps',
      tokens: [196, 18],
      cost: 0.0002,
      line: 'Figuring out exactly what this needs.'
    },
    {
      plan: 1,
      p: 0.3,
      kind: 'TOOL',
      name: 'search',
      input: `q="${s}"`,
      output: '9 results',
      line: 'Looking at the options now.'
    },
    {
      plan: 1,
      p: 0.46,
      kind: 'LLM',
      name: 'rank',
      input: 'top_k=2, criteria=[fit, cost]',
      output: '2 kept',
      tokens: [380, 22],
      cost: 0.0005,
      line: 'Narrowed it down to the two best fits.'
    },
    {
      plan: 2,
      p: 0.6,
      kind: 'TOOL',
      name: 'fetch_details',
      input: 'candidate=best',
      output: 'ok',
      line: 'Picked the best one. Checking the details.'
    }
  ]

  if (asks) {
    beats.push({
      p: 0.68,
      kind: 'GUARDRAIL',
      name: 'requires_approval',
      input: 'action=commit',
      output: 'paused',
      line: 'Ready to go ahead. Waiting for your okay.',
      ask: {
        kind: 'approve',
        category: 'action',
        q: `Ready to go ahead with “${short}”?`,
        facts: [
          ['What I’ll do', short],
          ['Cost', 'Nothing up front'],
          ['If you say no', "Nothing happens. I'll wait."]
        ],
        yes: 'Go ahead',
        no: 'Not yet'
      }
    })
  }

  beats.push(
    {
      plan: 3,
      p: 0.82,
      kind: 'TOOL',
      name: 'execute',
      input: `plan="${s}"`,
      output: '200 OK',
      line: asks ? 'Doing it now.' : 'On it.'
    },
    {
      plan: 4,
      p: 0.92,
      kind: 'GUARDRAIL',
      name: 'verify',
      input: 'check="the result is real"',
      output: 'confirmed',
      line: 'Checking it actually worked, rather than assuming.'
    },
    {
      done: true,
      kind: 'CHAIN',
      name: 'task_complete',
      input: `goal="${s}"`,
      output: 'verified',
      line: 'Finished, and I checked it.',
      minutes: 20,
      receipt: {
        lines: [
          ['What changed', short],
          ['Cost', 'Nothing spent'],
          ['Checked', 'Verified the result, not assumed it']
        ],
        proof: ['summary', 'screenshots'],
        undo: 'Reversible for 24 hours'
      }
    }
  )

  return {
    key: 'generic',
    title,
    plan: [
      'Understand what you need',
      'Look at the options',
      'Pick the best fit',
      asks ? 'Do it, once you approve' : 'Do it',
      'Check that it worked'
    ],
    beats
  }
}