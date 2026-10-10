/* ==========================================================================
   Done. — app demo engine
   A simulated agent. Every task is a small script of beats; the engine
   plays them at a calm, human pace and pauses whenever it needs you.
   All copy is written as plain sentences. The "underneath" line on each
   step is the machine record (what a neatlogs trace would hold).
   ========================================================================== */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var CIRC = 50.27;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ utils */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clock(ts) {
    var d = new Date(ts || Date.now());
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ap;
  }
  var WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  function word(n) { return WORDS[n] || String(n); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0); }
  function minutes(n) {
    if (n < 60) return n + ' minute' + (n === 1 ? '' : 's');
    var h = Math.floor(n / 60), m = n % 60;
    return h + ' hour' + (h === 1 ? '' : 's') + (m ? ' ' + m + ' min' : '');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fill(str, vars) {
    return String(str || '').replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] != null ? vars[k] : ''; });
  }
  function uid() { return 't' + Math.random().toString(36).slice(2, 9); }

  /* ------------------------------------------------------------------ dots */
  function makeDot() {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'dot');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    ['dot-track', 'dot-arc', 'dot-core'].forEach(function (cls) {
      var c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', '10'); c.setAttribute('cy', '10');
      if (cls !== 'dot-core') c.setAttribute('r', '8');
      svg.appendChild(c);
    });
    return svg;
  }
  function paintDot(svg, state, p) {
    var visual = state === 'you' ? 'paused' : state;
    svg.setAttribute('data-state', visual);
    svg.querySelector('.dot-arc').style.strokeDashoffset = String(CIRC * (1 - Math.max(0, Math.min(1, p || 0))));
  }

  /* ==================================================================
     Scripts — each beat is one sentence the agent says.
     ================================================================== */
  var SCRIPTS = {
    plumber: {
      plan: ['Find plumbers nearby with good reviews', 'Check who can come tomorrow', 'Compare prices', 'Book the one you pick', 'Double-check the booking'],
      beats: [
        { plan: 0, p: 0.12, line: 'Looking for plumbers near you with good reviews.', code: 'tool.search_places(q="plumber", radius=5km) → 14 results · 0.9s' },
        { plan: 1, p: 0.26, line: 'Six have strong reviews. Checking who can come tomorrow.', code: 'llm.rank(min_rating=4.6) → 6 kept · 388 tokens · $0.0004' },
        { tone: 'snag', p: 0.32, line: 'One booking site wouldn’t load. Calling their number instead.', code: 'browser.open(rapidflow.com/book) → 503 · fallback=voice_call' },
        { plan: 1, p: 0.46, line: 'Got through. Three can come tomorrow morning.', code: 'voice.call → slots parsed (3) · recovered after 1 retry' },
        { plan: 2, p: 0.6, line: 'Comparing prices and what’s included.', code: 'llm.compare(quotes=3, criteria=[price, rating, eta]) → 512 tokens' },
        { p: 0.72, line: 'Two good options. Which do you prefer?', code: 'policy.requires_choice(spend>limit) → paused for user',
          ask: { kind: 'choice', q: 'Two good options for tomorrow. Which one?',
            choices: [
              { value: 'north', label: 'Northside Plumbing at 9am', note: '$120 · 4.9 stars · 14 min away', cost: 120 },
              { value: 'rapid', label: 'Rapidflow at 11:30am', note: '$95 · 4.7 stars · 22 min away', cost: 95 }
            ], none: 'Neither, keep looking' } },
        { plan: 3, p: 0.84, line: 'Booking {choice}.', code: 'tool.book(provider={choiceKey}) → confirmation #PL-2291' },
        { plan: 4, p: 0.94, line: 'Double-checking the booking went through.', code: 'verify.email_receipt(match="PL-2291") → found · ok' },
        { done: true, line: 'Booked: {choice}. It’s on your calendar.', code: 'calendar.create(event) → ok · task complete',
          minutes: 35, receipt: { lines: [['Booked', '{choice}'], ['Cost', '{cost} · paid on arrival'], ['Checked', 'Confirmation email matches']], proof: ['booking confirmation', 'calendar event'], undo: 'Free cancellation until tonight' } }
      ]
    },
    gym: {
      plan: ['Find your membership', 'Check how to cancel', 'Write the request', 'Send it once you approve', 'Confirm it’s cancelled'],
      beats: [
        { plan: 0, p: 0.14, line: 'Found your Ironworks Gym membership.', code: 'email.search(from="ironworks") → member #44821' },
        { plan: 1, p: 0.24, line: 'Signing in to your gym account.', code: 'browser.login(ironworks.gym) → ok · 2.1s' },
        { tone: 'snag', p: 0.3, line: 'The cancel button is hidden for online accounts. Trying another way.', code: 'dom.find("Cancel membership") → not found · strategy=read_terms' },
        { plan: 2, p: 0.45, line: 'Their terms say a written request works. Drafted one for you.', code: 'doc.read(terms.pdf §7) → "written notice accepted" · llm.draft → 94 tokens' },
        { p: 0.56, line: 'Ready to send your cancellation. Waiting for your okay.', code: 'policy.requires_approval(type=message, irreversible=true) → paused',
          ask: { kind: 'approve', category: 'message', q: 'Send this cancellation email to Ironworks Gym?',
            draft: 'Hi,\nPlease cancel membership #44821, effective today, as allowed by section 7 of your terms.\nPlease confirm by email.\n\nThanks,\nAlex',
            facts: [['To', 'members@ironworks.gym'], ['You’ll save', '$39 a month']], yes: 'Send it', no: 'Not yet' } },
        { plan: 3, p: 0.7, line: 'Sent. Waiting for them to reply.', code: 'email.send → 250 OK · watch(inbox, from="ironworks")' },
        { plan: 4, p: 0.88, line: 'They replied. Checking it really says cancelled.', code: 'llm.verify(reply, expect="cancelled") → confirmed' },
        { done: true, line: 'Cancelled. You’ll save $39 a month.', code: 'task complete · savings=$468/yr',
          minutes: 50, receipt: { lines: [['What changed', 'Membership #44821 cancelled'], ['You save', '$39 a month'], ['Checked', 'Their reply confirms it']], proof: ['their reply', 'your request'], undo: null } }
      ]
    },
    refund: {
      plan: ['Find the order', 'Check the return rules', 'Start the return', 'Confirm the refund'],
      beats: [
        { plan: 0, p: 0.2, line: 'Found the order from March 14.', code: 'email.search(q="phone case") → order #112-4471' },
        { plan: 1, p: 0.42, line: 'It qualifies for a full refund.', code: 'tool.order_api(policy) → within 30 days · eligible' },
        { plan: 2, p: 0.66, line: 'Started the return. Label saved to your files.', code: 'tool.return.create → label.pdf · free drop-off' },
        { plan: 3, p: 0.88, line: 'Double-checking the refund amount.', code: 'verify(refund=24.00, paid=24.00) → match' },
        { done: true, line: 'Refund of $24 is on its way.', code: 'task complete', minutes: 15,
          receipt: { lines: [['Refund', '$24.00 to your card'], ['Arrives', 'In 3–5 days'], ['Checked', 'Refund matches what you paid']], proof: ['return label', 'refund email'], undo: 'Cancel return before drop-off' } }
      ]
    },
    dinner: {
      plan: ['Pick a menu for six', 'Make sure it works for a vegetarian', 'Build the grocery list', 'Order once you approve', 'Check the delivery slot'],
      beats: [
        { plan: 0, p: 0.14, line: 'Finding a menu for six, with one vegetarian.', code: 'llm.plan_menu(guests=6, diet=[vegetarian:1]) → 3 options · 620 tokens' },
        { plan: 1, p: 0.3, line: 'Mushroom risotto, a big salad, and lemon tart. All vegetarian.', code: 'llm.check_constraints → pass' },
        { plan: 2, p: 0.5, line: 'Building the grocery list from what you don’t already have.', code: 'tool.pantry.diff → 14 items needed' },
        { p: 0.64, line: 'Groceries are ready to order. Waiting for your okay.', code: 'policy.requires_approval(spend=$64.20 > limit) → paused',
          ask: { kind: 'approve', category: 'spend', cost: 64.2, q: 'Order the groceries for Saturday morning?',
            facts: [['Total', '$64.20 · 14 items'], ['Delivery', 'Saturday, 9–10am'], ['If you say no', 'I’ll send you the list instead']], yes: 'Order', no: 'I’ll shop myself' } },
        { plan: 3, p: 0.8, line: 'Ordered. Delivery is Saturday, 9–10am.', code: 'tool.grocer.checkout → order #G-8812' },
        { plan: 4, p: 0.92, line: 'Checking the delivery slot is confirmed.', code: 'verify.order_status(G-8812) → confirmed' },
        { done: true, line: 'Dinner’s sorted. Groceries arrive Saturday morning.', code: 'task complete', minutes: 45,
          receipt: { lines: [['Menu', 'Risotto, salad, lemon tart'], ['Groceries', '$64.20 · arriving Sat 9–10am'], ['Checked', 'Order confirmed by the store']], proof: ['recipe cards', 'order receipt'], undo: 'Cancel order until Friday 8pm' } }
      ]
    }
  };

  var NEEDS_APPROVAL = /\b(book|buy|order|pay|send|email|cancel|sign|reserve|schedule|call|text|hire|renew|subscribe|apply|transfer|return)\b/i;

  function genericScript(title) {
    var short = title.length > 46 ? title.slice(0, 44).trim() + '…' : title;
    var asks = NEEDS_APPROVAL.test(title);
    var beats = [
      { plan: 0, p: 0.1, line: 'Figuring out exactly what this needs.', code: 'llm.parse_goal("' + short.replace(/"/g, '\'') + '") → 4 steps · 214 tokens' },
      { plan: 1, p: 0.26, line: 'Made a plan. Looking at the options now.', code: 'tool.search → 9 results · 1.4s' },
      { plan: 1, p: 0.42, line: 'Narrowed it down to the two best fits.', code: 'llm.rank(top_k=2) → 402 tokens · $0.0005' },
      { plan: 2, p: 0.56, line: 'Picked the best one. Checking the details.', code: 'tool.fetch(details) → ok' }
    ];
    if (asks) {
      beats.push({ p: 0.66, line: 'Ready to go ahead. Waiting for your okay.', code: 'policy.requires_approval(action=commit) → paused',
        ask: { kind: 'approve', category: 'action', q: 'Ready to go ahead with this?',
          facts: [['What I’ll do', short], ['Cost', 'Nothing up front'], ['If you say no', 'Nothing happens. I’ll wait.']], yes: 'Go ahead', no: 'Not yet' } });
    }
    beats.push({ plan: 3, p: 0.8, line: 'Doing it now.', code: 'tool.execute → 200 OK' });
    beats.push({ plan: 4, p: 0.92, line: 'Double-checking it actually worked.', code: 'verify(outcome) → pass' });
    beats.push({ done: true, line: 'Finished. Receipt saved.', code: 'task complete', minutes: 20,
      receipt: { lines: [['What changed', short], ['Cost', 'Nothing spent'], ['Checked', 'Verified the result once']], proof: ['summary', 'screenshots'], undo: 'Reversible for 24 hours' } });
    return {
      plan: ['Understand what you need', 'Look at the options', 'Pick the best fit', asks ? 'Do it, once you approve' : 'Do it', 'Check that it worked'],
      beats: beats
    };
  }

  /* ==================================================================
     State
     ================================================================== */
  var tasks = [];          // newest first
  var dynScripts = {};     // id -> generated script
  var openId = null;
  var cursorId = null;
  var allPaused = false;
  var undoStack = [];
  var limits = { spend: 0, messages: true, quiet: false };
  var ledger = { spent: 0, minutes: 0 };

  function scriptOf(t) { return SCRIPTS[t.script] || dynScripts[t.id]; }
  function byId(id) { for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i]; return null; }

  function newTask(title, scriptKey, opts) {
    var t = {
      id: uid(), title: title, script: scriptKey || null,
      state: 'waiting', progress: 0, line: 'Written down. Starting in a moment.',
      planIdx: -1, beatIdx: 0, story: [], ask: null, receipt: null,
      vars: {}, created: Date.now(), nextAt: Date.now() + 1600,
      finishedAt: null, settleUntil: 0, prevState: null, notes: [],
      when: (opts && opts.when) || null, budget: (opts && opts.budget) || null
    };
    if (!scriptKey) dynScripts[t.id] = genericScript(title);
    return t;
  }

  function say(t, text, code, tone, ts) {
    t.story.push({ t: clock(ts), text: text, code: code || '', tone: tone || '' });
  }

  /* ------------------------------------------------------------------ engine */
  function advance(t) {
    var s = scriptOf(t);
    var b = s.beats[t.beatIdx];
    if (!b) return;
    t.beatIdx++;
    if (typeof b.plan === 'number') t.planIdx = b.plan;
    t.progress = b.p != null ? b.p : t.progress;
    var line = fill(b.line, t.vars);

    if (b.ask) {
      var ask = clone(b.ask);
      // Respect the user's limits: small spends and unchecked messages go ahead on their own.
      var auto = (ask.kind === 'approve' && ask.category === 'spend' && ask.cost <= limits.spend) ||
                 (ask.kind === 'approve' && ask.category === 'message' && !limits.messages);
      if (auto) {
        say(t, ask.category === 'spend' ? 'This is under your ' + money(limits.spend) + ' limit, so I went ahead.' : 'You let me send messages on my own, so I sent it.', 'policy.auto_approve(rule=user_limit) → ok', 'you');
        if (ask.cost) ledger.spent += ask.cost;
        t.state = 'working';
        t.nextAt = Date.now() + 1400;
        return;
      }
      t.ask = ask;
      t.state = 'needs';
      t.line = line;
      say(t, line, b.code, 'needs');
      return;
    }

    if (b.done) {
      t.state = 'done';
      t.progress = 1;
      t.planIdx = s.plan.length;
      t.line = line;
      t.finishedAt = Date.now();
      t.settleUntil = Date.now() + 1700;
      t.justDone = true;
      var r = clone(b.receipt);
      r.lines = r.lines.map(function (pair) { return [pair[0], fill(pair[1], t.vars)]; });
      r.took = Math.max(1, Math.round((Date.now() - t.created) / 60000));
      t.receipt = r;
      ledger.minutes += b.minutes || 15;
      say(t, line, b.code, 'done');
      return;
    }

    t.state = b.tone === 'snag' ? 'snag' : 'working';
    t.line = line;
    say(t, line, b.code, b.tone === 'snag' ? 'snag' : '');
    t.nextAt = Date.now() + (b.tone === 'snag' ? 4200 : 2800 + Math.random() * 1800);
  }

  function tick() {
    var now = Date.now();
    var dirty = false;
    tasks.forEach(function (t) {
      if ((t.state === 'working' || t.state === 'snag' || t.state === 'waiting') && now >= t.nextAt) {
        advance(t); dirty = true; changed(t);
      }
      if (t.settleUntil && now >= t.settleUntil) { t.settleUntil = 0; dirty = true; }
    });
    if (dirty) renderAll();
  }

  /* ------------------------------------------------------------------ actions */
  function snapshot(t) { return { id: t.id, data: clone(t), ledger: clone(ledger) }; }
  function pushUndo(label, snaps) { undoStack.push({ label: label, snaps: snaps }); if (undoStack.length > 30) undoStack.shift(); }
  function undo() {
    var u = undoStack.pop();
    if (!u) { toast('Nothing to undo.'); return; }
    u.snaps.forEach(function (s) {
      var t = byId(s.id);
      if (!t) return;
      Object.keys(s.data).forEach(function (k) { t[k] = s.data[k]; });
      if (t.state === 'working' || t.state === 'snag' || t.state === 'waiting') t.nextAt = Date.now() + 1800;
      if (s.ledger) { ledger.spent = s.ledger.spent; ledger.minutes = s.ledger.minutes; }
      changed(t, true);
    });
    if (u.allPaused != null) { allPaused = u.allPaused; syncPauseAll(); }
    renderAll();
    toast('Undone: ' + u.label.toLowerCase() + '.');
  }

  function togglePause(t) {
    if (!t) return;
    if (t.state === 'paused') {
      t.state = t.prevState || 'working';
      t.prevState = null;
      t.line = 'Picking up where I left off.';
      say(t, 'You resumed it. Picking up where I left off.', 'control.resume', 'you');
      t.nextAt = Date.now() + 1600;
    } else if (t.state === 'working' || t.state === 'snag' || t.state === 'waiting') {
      t.prevState = t.state === 'snag' ? 'working' : t.state;
      t.state = 'paused';
      t.line = 'Paused. Nothing will happen until you resume.';
      say(t, 'You paused it. Holding exactly here.', 'control.pause → state checkpointed', 'you');
    } else return;
    changed(t, true); renderAll();
  }

  function toggleTake(t) {
    if (!t) return;
    if (t.state === 'you') {
      t.state = 'working';
      t.line = 'Back to me. Continuing from where you left off.';
      say(t, 'You handed it back. Continuing from where you left off.', 'control.handback → context merged', 'you');
      t.nextAt = Date.now() + 1800;
    } else if (t.state === 'working' || t.state === 'snag' || t.state === 'waiting' || t.state === 'paused' || t.state === 'needs') {
      t.prevState = null;
      if (t.state === 'needs') { t.beatIdx = Math.max(0, t.beatIdx - 1); t.ask = null; }
      t.state = 'you';
      t.line = 'It’s yours. Everything I found is in the story below.';
      say(t, 'You took over. I stopped and left you everything I found.', 'control.takeover → handoff bundle (notes, links, drafts)', 'you');
    } else return;
    changed(t, true); renderAll();
  }

  function stopTask(t) {
    if (!t || t.state === 'done' || t.state === 'stopped') return;
    pushUndo('Stop', [snapshot(t)]);
    t.state = 'stopped';
    t.ask = null;
    t.line = 'Stopped. Nothing was changed.';
    t.finishedAt = Date.now();
    say(t, 'You stopped it. Nothing was changed.', 'control.stop → no side effects', 'you');
    changed(t, true); renderAll();
    toast('Stopped “' + shortTitle(t.title) + '”.', true);
  }

  function steer(t, text) {
    if (!t || !text) return;
    say(t, 'You said: “' + text + '”', 'control.steer(instruction)', 'you');
    t.notes.push(text);
    changed(t, true); renderAll();
    setTimeout(function () {
      say(t, 'Got it. I’ll keep “' + text + '” in mind from here on.', 'llm.replan(constraint="' + text.replace(/"/g, '\'') + '") → plan updated', '');
      if (t.state === 'working' || t.state === 'snag') { t.line = 'Adjusting for “' + text + '”.'; t.nextAt = Date.now() + 2600; }
      changed(t, true); renderAll();
    }, 1100);
  }

  function answer(t, value) {
    if (!t || !t.ask) return;
    var ask = t.ask;
    pushUndo('Your answer', [snapshot(t)]);
    if (ask.kind === 'approve') {
      if (value === 'yes') {
        say(t, 'You said yes.', 'user.approve', 'you');
        if (ask.cost) ledger.spent += ask.cost;
        t.ask = null; t.state = 'working'; t.line = 'Thanks. Going ahead.';
        t.nextAt = Date.now() + 1300;
        toast('Going ahead with “' + shortTitle(t.title) + '”.', true);
      } else {
        say(t, 'You said not yet.', 'user.decline → hold', 'you');
        t.ask = null; t.beatIdx = Math.max(0, t.beatIdx - 1);
        t.prevState = 'working'; t.state = 'paused';
        t.line = 'Holding off. Resume whenever you’re ready.';
      }
    } else if (ask.kind === 'choice') {
      if (value === '__none') {
        say(t, 'You said neither.', 'user.reject_all → search again', 'you');
        t.ask = null; t.beatIdx = Math.max(0, t.beatIdx - 2);
        t.state = 'working'; t.line = 'Okay. Looking for more options.';
        t.nextAt = Date.now() + 2400;
      } else {
        var c = ask.choices.filter(function (x) { return x.value === value; })[0];
        t.vars.choice = c.label; t.vars.choiceKey = c.value; t.vars.cost = money(c.cost);
        if (c.cost) ledger.spent += c.cost;
        say(t, 'You picked ' + c.label + '.', 'user.choose(' + c.value + ')', 'you');
        t.ask = null; t.state = 'working'; t.line = 'Good choice. Booking it now.';
        t.nextAt = Date.now() + 1300;
        toast('Booking ' + c.label + '.', true);
      }
    }
    changed(t, true); renderAll();
  }

  function reverseDone(t) {
    if (!t || t.state !== 'done' || !t.receipt || !t.receipt.undo) return;
    pushUndo('Reverse', [snapshot(t)]);
    t.state = 'stopped';
    t.line = 'Reversed. Everything is back how it was.';
    say(t, 'You reversed it. Everything is back how it was.', 'control.revert → compensating action ok', 'you');
    changed(t, true); renderAll();
    toast('Reversed “' + shortTitle(t.title) + '”.', true);
  }

  function setAllPaused(on) {
    var snaps = [];
    tasks.forEach(function (t) {
      if (on && (t.state === 'working' || t.state === 'snag' || t.state === 'waiting')) {
        snaps.push(snapshot(t));
        t.prevState = t.state === 'snag' ? 'working' : t.state; t.state = 'paused';
        t.line = 'Paused with everything else.';
        say(t, 'You paused everything.', 'control.pause_all', 'you');
        changed(t, true);
      } else if (!on && t.state === 'paused') {
        snaps.push(snapshot(t));
        t.state = t.prevState || 'working'; t.prevState = null;
        t.line = 'Picking up where I left off.';
        t.nextAt = Date.now() + 1200 + Math.random() * 1600;
        say(t, 'You resumed everything.', 'control.resume_all', 'you');
        changed(t, true);
      }
    });
    var u = { label: on ? 'Pause all' : 'Resume all', snaps: snaps, allPaused: !on };
    undoStack.push(u);
    allPaused = on;
    syncPauseAll();
    renderAll();
    toast(on ? 'Everything is paused.' : 'Everything is moving again.', true);
  }
  function syncPauseAll() {
    var btn = $('pause-all-btn');
    btn.setAttribute('aria-pressed', String(allPaused));
    btn.querySelector('.icon-btn-label').textContent = allPaused ? 'Resume all' : 'Pause all';
    btn.querySelector('svg').innerHTML = allPaused
      ? '<path d="M7 5.5v9l7.5-4.5L7 5.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'
      : '<path d="M7.5 5.5v9M12.5 5.5v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
    document.body.classList.toggle('is-all-paused', allPaused);
  }

  function shortTitle(s) { return s.length > 34 ? s.slice(0, 32).trim() + '…' : s; }

  /* ==================================================================
     Rendering
     ================================================================== */
  var rows = {};           // id -> { el, dot, title, line, side, lastLine, lastState }
  var lastOrderSig = '';

  function groupOf(t) {
    if (t.state === 'needs') return 'needs';
    if ((t.state === 'done' && !t.settleUntil) || t.state === 'stopped') return 'done';
    return 'going';
  }

  function ensureRow(t) {
    if (rows[t.id]) return rows[t.id];
    var li = document.createElement('li');
    li.className = 'task';
    li.setAttribute('data-id', t.id);
    li.setAttribute('tabindex', '-1');
    var dot = makeDot();
    var title = document.createElement('span'); title.className = 'task-title';
    var line = document.createElement('span'); line.className = 'task-line';
    var side = document.createElement('span'); side.className = 'task-side';
    li.appendChild(dot); li.appendChild(title); li.appendChild(side); li.appendChild(line);
    var r = { el: li, dot: dot, title: title, line: line, side: side, lastLine: null, lastState: null, lastSide: null };
    rows[t.id] = r;
    return r;
  }

  function sideFor(t) {
    if (t.state === 'needs') return 'answer';
    if (t.state === 'paused') return 'Paused';
    if (t.state === 'you') return 'With you';
    if (t.state === 'done' || t.state === 'stopped') return t.finishedAt ? clock(t.finishedAt) : '';
    if (t.state === 'waiting') return t.when ? t.when : 'Soon';
    return '';
  }

  function renderRow(t) {
    var r = ensureRow(t);
    r.title.textContent = t.title;
    r.el.setAttribute('data-state', t.state);
    r.el.setAttribute('aria-label', t.title + '. ' + t.line);
    paintDot(r.dot, t.state, t.progress);
    r.el.classList.toggle('is-open', t.id === openId);
    r.el.classList.toggle('is-cursor', t.id === cursorId && t.id !== openId);

    if (r.lastLine !== t.line) {
      if (r.lastLine === null || reduce) { r.line.textContent = t.line; }
      else {
        r.line.classList.add('is-swapping');
        var next = t.line;
        setTimeout(function () { r.line.textContent = next; r.line.classList.remove('is-swapping'); }, 240);
      }
      r.lastLine = t.line;
    }
    var side = sideFor(t);
    if (r.lastSide !== side) {
      r.side.innerHTML = '';
      if (side === 'answer') {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'task-quick'; b.textContent = 'Answer';
        b.addEventListener('click', function (e) { e.stopPropagation(); openDetail(t.id, true); });
        r.side.appendChild(b);
      } else r.side.textContent = side;
      r.lastSide = side;
    }
    if (t.justDone) {
      t.justDone = false;
      r.el.classList.remove('just-done'); void r.el.offsetWidth; r.el.classList.add('just-done');
      if (!reduce) {
        var ring = document.createElement('span'); ring.className = 'done-ring';
        r.el.appendChild(ring);
        setTimeout(function () { ring.remove(); }, 1200);
      }
    }
  }

  function orderedIn(group) {
    var list = tasks.filter(function (t) { return groupOf(t) === group; });
    if (group === 'done') list.sort(function (a, b) { return (b.finishedAt || 0) - (a.finishedAt || 0); });
    return list;
  }

  function renderAll() {
    tasks.forEach(renderRow);
    var groups = { needs: orderedIn('needs'), going: orderedIn('going'), done: orderedIn('done') };
    var sig = ['needs', 'going', 'done'].map(function (g) { return g + ':' + groups[g].map(function (t) { return t.id; }).join(','); }).join('|');
    if (sig !== lastOrderSig) {
      lastOrderSig = sig;
      ['needs', 'going', 'done'].forEach(function (g) {
        var ol = $('tasks-' + g);
        groups[g].forEach(function (t, i) {
          var el = rows[t.id].el;
          if (ol.children[i] !== el) ol.insertBefore(el, ol.children[i] || null);
        });
      });
      $('group-needs').hidden = groups.needs.length === 0;
      $('group-done').hidden = groups.done.length === 0;
      $('group-going').hidden = groups.going.length === 0 && groups.needs.length + groups.done.length > 0;
      $('done-count').textContent = groups.done.length;
    }
    renderSummary(groups);
    renderLedger();
    if (openId) renderDetail();
  }

  function renderSummary(g) {
    var el = $('day-summary');
    var needs = g.needs.length;
    var going = g.going.filter(function (t) { return t.state !== 'paused' && t.state !== 'you'; }).length;
    var html;
    if (allPaused) html = 'Everything’s paused. Nothing will move until you say.';
    else if (!needs && !going) html = 'Everything’s done. Nothing needs you.';
    else {
      var parts = [];
      if (needs) parts.push('<span class="needs-word">' + word(needs) + (needs === 1 ? ' thing needs you.' : ' things need you.') + '</span>');
      if (going) parts.push(word(going) + ' going quietly.');
      html = parts.join(' ');
    }
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderLedger() {
    $('ledger-spend').textContent = ledger.spent ? 'Spent ' + money(ledger.spent) + ' today, all approved by you' : 'Spent nothing today';
    $('ledger-time').textContent = 'Saved you about ' + minutes(ledger.minutes);
  }

  /* ------------------------------------------------------------------ detail */
  var STATE_WORDS = {
    waiting: 'Waiting to start', working: 'On it', needs: 'Needs you', snag: 'Hit a snag · trying another way',
    paused: 'Paused', you: 'You’re doing this one', done: 'Done', stopped: 'Stopped'
  };
  var renderedStory = { id: null, count: 0 };
  var renderedAskKey = '';
  var lastNow = '';

  function changed(t) { /* hook for future persistence; render is batched in renderAll */ }

  function openDetail(id, focusAsk) {
    openId = id; cursorId = id;
    $('detail').classList.add('is-open');
    $('detail').setAttribute('aria-hidden', 'false');
    $('app-shell').classList.add('has-detail');
    $('detail').scrollTop = 0;
    renderedStory = { id: null, count: 0 };
    renderedAskKey = ''; lastNow = '';
    $('steer-form').hidden = true;
    renderAll();
    if (focusAsk) setTimeout(function () { var b = $('detail-ask').querySelector('button'); if (b) b.focus(); }, 350);
  }
  function closeDetail() {
    openId = null;
    $('detail').classList.remove('is-open');
    $('detail').setAttribute('aria-hidden', 'true');
    $('app-shell').classList.remove('has-detail');
    renderAll();
  }

  function renderDetail() {
    var t = byId(openId);
    if (!t) return closeDetail();
    var s = scriptOf(t);

    var st = $('detail-state');
    st.textContent = STATE_WORDS[t.state];
    st.className = 'detail-state' + (t.state === 'needs' ? ' is-needs' : t.state === 'snag' ? ' is-snag' : '');
    paintDot($('detail-dot'), t.state, t.progress);
    $('detail-title').textContent = t.title;

    var now = $('detail-now');
    if (lastNow !== t.line) {
      if (!lastNow || reduce) now.textContent = t.line;
      else { now.classList.add('is-swapping'); var nx = t.line; setTimeout(function () { now.textContent = nx; now.classList.remove('is-swapping'); }, 240); }
      lastNow = t.line;
    }
    var stepNow = Math.min(s.plan.length, Math.max(0, t.planIdx + (t.state === 'done' ? 0 : 1)));
    var meta = 'Started ' + clock(t.created) + ' · step ' + stepNow + ' of ' + s.plan.length;
    if (t.when) meta += ' · ' + t.when.toLowerCase();
    if (t.budget) meta += ' · ' + t.budget.toLowerCase();
    if (t.state === 'done') meta = 'Finished ' + clock(t.finishedAt) + ' · took ' + minutes(t.receipt ? t.receipt.took : 1);
    $('detail-meta').textContent = meta;

    // Ask
    var askEl = $('detail-ask');
    var askKey = t.ask ? t.id + ':' + t.beatIdx : '';
    if (askKey !== renderedAskKey) {
      renderedAskKey = askKey;
      if (!t.ask) { askEl.hidden = true; askEl.innerHTML = ''; }
      else {
        var a = t.ask, h = '<p class="ask-q">' + esc(a.q) + '</p>';
        if (a.draft) h += '<div class="ask-draft">' + esc(a.draft) + '</div>';
        if (a.facts) h += '<dl class="ask-facts">' + a.facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>';
        if (a.kind === 'approve') {
          h += '<div class="ask-options"><button type="button" class="btn btn-solid" data-answer="yes">' + esc(a.yes || 'Yes') + '</button>' +
               '<button type="button" class="btn btn-ghost" data-answer="no">' + esc(a.no || 'Not yet') + '</button></div>';
        } else if (a.kind === 'choice') {
          h += '<div class="ask-choices">' + a.choices.map(function (c) {
            return '<button type="button" class="choice" data-answer="' + esc(c.value) + '"><span>' + esc(c.label) + '</span><small class="num">' + esc(c.note) + '</small></button>';
          }).join('') + '</div><div class="ask-options"><button type="button" class="btn btn-text" data-answer="__none">' + esc(a.none) + '</button></div>';
        }
        askEl.innerHTML = h;
        askEl.hidden = false;
      }
    }

    // Controls
    var live = t.state === 'working' || t.state === 'snag' || t.state === 'waiting';
    var finished = t.state === 'done' || t.state === 'stopped';
    $('detail-controls').hidden = finished;
    var pause = $('ctrl-pause');
    pause.querySelector('.ctrl-label').textContent = t.state === 'paused' ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(t.state === 'paused'));
    pause.disabled = !(live || t.state === 'paused');
    var take = $('ctrl-take');
    take.querySelector('.ctrl-label').textContent = t.state === 'you' ? 'Hand back' : 'Take over';
    take.setAttribute('aria-pressed', String(t.state === 'you'));
    $('ctrl-steer').disabled = t.state === 'you';
    if (finished) $('steer-form').hidden = true;

    // Receipt
    var rc = $('detail-receipt');
    if (t.state === 'done' && t.receipt) {
      var r = t.receipt;
      var key = 'r:' + t.id;
      if (rc.getAttribute('data-key') !== key) {
        rc.setAttribute('data-key', key);
        rc.innerHTML = '<dl>' + r.lines.map(function (l) { return '<div><dt>' + esc(l[0]) + '</dt><dd>' + esc(l[1]) + '</dd></div>'; }).join('') +
          '<div><dt>Proof</dt><dd>' + r.proof.map(function (p) { return '<span class="chip">' + esc(p) + '</span>'; }).join('') + '</dd></div>' +
          '<div><dt>Undo</dt><dd>' + (r.undo ? '<button type="button" class="receipt-undo" id="receipt-undo">' + esc(r.undo) + '</button>' : '<span style="color:var(--text-3)">Can’t be undone. That’s why it asked first.</span>') + '</dd></div></dl>';
      }
      rc.hidden = false;
    } else { rc.hidden = true; rc.removeAttribute('data-key'); }

    // Plan
    var planHtml = s.plan.map(function (p, i) {
      var cls = i < t.planIdx || t.state === 'done' ? 'is-done' : i === t.planIdx ? 'is-now' : '';
      return '<li class="' + cls + '">' + esc(p) + '</li>';
    }).join('') + t.notes.map(function (n) { return '<li class="is-new">Keep in mind: “' + esc(n) + '”</li>'; }).join('');
    var planEl = $('detail-plan');
    if (planEl.getAttribute('data-html') !== planHtml) { planEl.innerHTML = planHtml; planEl.setAttribute('data-html', planHtml); }

    // Story — newest first; append only what's new so nothing jumps.
    var story = $('detail-story');
    if (renderedStory.id !== t.id || renderedStory.count > t.story.length) {
      story.innerHTML = '';
      t.story.slice().reverse().forEach(function (e) { story.appendChild(storyItem(e, true)); });
      renderedStory = { id: t.id, count: t.story.length };
    } else if (renderedStory.count < t.story.length) {
      t.story.slice(renderedStory.count).forEach(function (e) { story.insertBefore(storyItem(e, false), story.firstChild); });
      renderedStory.count = t.story.length;
    }
  }

  function storyItem(e, still) {
    var li = document.createElement('li');
    if (e.tone) li.setAttribute('data-tone', e.tone);
    if (still) li.style.animation = 'none';
    li.innerHTML = '<time class="num">' + esc(e.t) + '</time><p>' + esc(e.text) + '</p>' + (e.code ? '<code>' + esc(e.code) + '</code>' : '');
    return li;
  }

  /* ------------------------------------------------------------------ toast */
  var toastTimer = null;
  function toast(text, canUndo) {
    var el = $('toast');
    $('toast-text').textContent = text;
    $('toast-undo').hidden = !canUndo;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('is-on'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-on');
      setTimeout(function () { if (!el.classList.contains('is-on')) el.hidden = true; }, 450);
    }, 4200);
  }

  /* ==================================================================
     Seed — a believable morning. Within seconds, one thing will need you.
     ================================================================== */
  function fastForward(t, n, minutesAgo) {
    var base = Date.now() - minutesAgo * 60000;
    t.created = base;
    for (var i = 0; i < n; i++) {
      var ts = base + (i + 1) * (minutesAgo * 60000 / (n + 1));
      advance(t);
      if (t.story.length) t.story[t.story.length - 1].t = clock(ts);
    }
    t.nextAt = Date.now() + 2200 + Math.random() * 2400;
  }

  function seed() {
    // already finished this morning
    var ins = newTask('Renew the car insurance', 'refund');
    ins.created = Date.now() - 3 * 3600000;
    ins.state = 'done'; ins.progress = 1; ins.planIdx = 4; ins.beatIdx = 99;
    ins.finishedAt = Date.now() - 2.4 * 3600000;
    ins.line = 'Renewed with the same cover for $212 less a year.';
    dynScripts[ins.id] = { plan: ['Compare quotes for the same cover', 'Pick the cheapest that matches', 'Switch once you approve', 'Check the new policy'], beats: [] };
    ins.script = null;
    ins.story = [
      { t: clock(ins.created), text: 'Compared 9 quotes for exactly the same cover.', code: 'tool.quotes(cover=current) → 9 · 2.8s', tone: '' },
      { t: clock(ins.created + 600000), text: 'Found the same cover for $212 less a year.', code: 'llm.compare → best=Harbor Mutual', tone: '' },
      { t: clock(ins.created + 900000), text: 'You said yes to switching.', code: 'user.approve', tone: 'you' },
      { t: clock(ins.finishedAt - 120000), text: 'Checked the new policy matches the old one line by line.', code: 'verify.diff(policy_old, policy_new) → 0 differences in cover', tone: '' },
      { t: clock(ins.finishedAt), text: 'Renewed. New policy saved to your files.', code: 'task complete', tone: 'done' }
    ];
    ins.receipt = { lines: [['What changed', 'Same cover, new insurer'], ['You save', '$212 a year'], ['Checked', 'Cover matches, line by line']], proof: ['policy.pdf', 'confirmation email'], undo: 'Switch back until Nov 2', took: 18 };
    ledger.minutes += 60;

    var bill = newTask('Pay the electricity bill', null);
    bill.state = 'done'; bill.progress = 1; bill.planIdx = 5; bill.beatIdx = 99;
    bill.created = Date.now() - 4 * 3600000; bill.finishedAt = Date.now() - 3.8 * 3600000;
    bill.line = 'Paid $86.40, under your usual amount.';
    bill.story = [
      { t: clock(bill.created), text: 'Found this month’s bill: $86.40.', code: 'email.search(from="cityPower") → invoice #88213', tone: '' },
      { t: clock(bill.created + 300000), text: 'It matches your usual amount, so it was okay to pay.', code: 'policy.auto_approve(recurring, within 10% of avg) → ok', tone: 'you' },
      { t: clock(bill.finishedAt), text: 'Paid. Receipt saved.', code: 'tool.pay → ok · task complete', tone: 'done' }
    ];
    bill.receipt = { lines: [['Paid', '$86.40 to City Power'], ['Why it didn’t ask', 'Same as usual, you allowed this'], ['Checked', 'Payment cleared']], proof: ['receipt'], undo: null, took: 6 };
    ledger.spent += 0; ledger.minutes += 10;

    var dinner = newTask('Plan Saturday dinner for six, one vegetarian', 'dinner');
    dinner.line = 'Starts once the morning list is quieter.';
    dinner.nextAt = Date.now() + 26000;
    dinner.when = 'By Friday';

    var refund = newTask('Get a refund for the cracked phone case', 'refund');
    fastForward(refund, 1, 4);

    var gym = newTask('Cancel the gym membership I don’t use', 'gym');
    fastForward(gym, 4, 12);
    gym.nextAt = Date.now() + 3200;

    var plumber = newTask('Find a plumber for the kitchen sink', 'plumber');
    fastForward(plumber, 1, 2);

    tasks = [plumber, gym, refund, dinner, bill, ins];

    // Arrived from the landing page with a thought already written?
    var q = new URLSearchParams(location.search).get('t');
    if (q && q.trim()) {
      var t = newTask(q.trim().slice(0, 140), null);
      tasks.unshift(t);
      history.replaceState(null, '', location.pathname);
      setTimeout(function () { openDetail(t.id); }, 700);
    }
  }

  /* ==================================================================
     Wiring
     ================================================================== */
  function visibleOrder() {
    var out = [];
    ['needs', 'going', 'done'].forEach(function (g) {
      if (g === 'done' && $('group-done').classList.contains('is-collapsed')) return;
      out = out.concat(orderedIn(g));
    });
    return out;
  }

  // Composer
  var composer = $('composer'), input = $('composer-input');
  var EXTRAS = {
    when: ['whenever', 'today', 'this week', 'by Friday'],
    budget: ['no spending', '$25', '$100', '$500'],
    ask: ['before anything big', 'before every step', 'only if stuck']
  };
  var extraIdx = { when: 0, budget: 0, ask: 0 };
  input.addEventListener('input', function () { composer.classList.toggle('has-text', input.value.trim().length > 0); });
  composer.addEventListener('click', function (e) {
    var pill = e.target.closest('[data-extra]');
    if (!pill) return;
    var k = pill.getAttribute('data-extra');
    extraIdx[k] = (extraIdx[k] + 1) % EXTRAS[k].length;
    pill.querySelector('span').textContent = EXTRAS[k][extraIdx[k]];
    input.focus();
  });
  composer.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value.trim();
    if (!v) return;
    var when = extraIdx.when ? 'By ' + EXTRAS.when[extraIdx.when].replace(/^by /, '') : null;
    if (when === 'By today') when = 'Today';
    var budget = extraIdx.budget ? 'Up to ' + EXTRAS.budget[extraIdx.budget] : null;
    var t = newTask(v, null, { when: when, budget: budget });
    say(t, 'You wrote this down.', 'task.create', 'you');
    tasks.unshift(t);
    var r = ensureRow(t);
    r.el.classList.add('is-entering');
    input.value = '';
    composer.classList.remove('has-text');
    extraIdx = { when: 0, budget: 0, ask: 0 };
    composer.querySelectorAll('[data-extra]').forEach(function (p) { p.querySelector('span').textContent = EXTRAS[p.getAttribute('data-extra')][0]; });
    renderAll();
    requestAnimationFrame(function () { requestAnimationFrame(function () { r.el.classList.remove('is-entering'); }); });
    toast('Written down. It’ll start in a moment.', false);
  });

  // List clicks
  $('lists').addEventListener('click', function (e) {
    var row = e.target.closest('.task');
    if (!row) return;
    var id = row.getAttribute('data-id');
    if (openId === id) closeDetail(); else openDetail(id);
  });
  $('group-done-title').addEventListener('click', function () {
    var g = $('group-done');
    var collapsed = g.classList.toggle('is-collapsed');
    this.setAttribute('aria-expanded', String(!collapsed));
  });

  // Detail
  $('detail-close').addEventListener('click', closeDetail);
  $('ctrl-pause').addEventListener('click', function () { togglePause(byId(openId)); });
  $('ctrl-take').addEventListener('click', function () { toggleTake(byId(openId)); });
  $('ctrl-stop').addEventListener('click', function () { stopTask(byId(openId)); });
  $('ctrl-steer').addEventListener('click', function () {
    var f = $('steer-form');
    f.hidden = !f.hidden;
    if (!f.hidden) $('steer-input').focus();
  });
  $('steer-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('steer-input').value.trim();
    if (!v) return;
    steer(byId(openId), v);
    $('steer-input').value = '';
    $('steer-form').hidden = true;
  });
  $('detail-ask').addEventListener('click', function (e) {
    var b = e.target.closest('[data-answer]');
    if (b) answer(byId(openId), b.getAttribute('data-answer'));
  });
  $('detail-receipt').addEventListener('click', function (e) {
    if (e.target.closest('#receipt-undo')) reverseDone(byId(openId));
  });
  $('under-toggle').addEventListener('click', function () {
    var on = this.getAttribute('aria-checked') !== 'true';
    this.setAttribute('aria-checked', String(on));
    this.querySelector('.switch-label').textContent = on ? 'Hide what’s underneath' : 'Show what’s underneath';
    $('detail-story').classList.toggle('show-under', on);
  });

  // Top bar
  $('pause-all-btn').addEventListener('click', function () { setAllPaused(!allPaused); });
  $('toast-undo').addEventListener('click', undo);

  // Dialogs
  function openDialog(id) {
    var d = $(id);
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  document.querySelectorAll('.sheet-modal').forEach(function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-close]')) d.close ? d.close() : d.removeAttribute('open');
    });
  });
  $('limits-btn').addEventListener('click', function () { openDialog('limits-sheet'); });
  $('keys-btn').addEventListener('click', function () { openDialog('keys-sheet'); });
  $('spend-seg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]');
    if (!b) return;
    this.querySelectorAll('[data-v]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
    limits.spend = Number(b.getAttribute('data-v'));
  });
  document.querySelectorAll('[data-limit]').forEach(function (sw) {
    sw.addEventListener('click', function () {
      var on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      limits[sw.getAttribute('data-limit')] = on;
    });
  });

  // Keyboard
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    var modalOpen = document.querySelector('.sheet-modal[open]');
    if (e.key === 'Escape') {
      if (modalOpen) return;
      if (typing) { document.activeElement.blur(); if (!$('steer-form').hidden) $('steer-form').hidden = true; return; }
      if (openId) closeDetail();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if (typing || modalOpen || e.metaKey || e.ctrlKey || e.altKey) return;

    var order = visibleOrder();
    var cur = byId(openId || cursorId);
    var idx = cur ? order.indexOf(cur) : -1;
    switch (e.key) {
      case 'n': case 'N': e.preventDefault(); input.focus(); break;
      case 'j': case 'ArrowDown':
        e.preventDefault();
        var nx = order[Math.min(order.length - 1, idx + 1)];
        if (nx) { cursorId = nx.id; if (openId) openDetail(nx.id); else renderAll(); rows[nx.id].el.scrollIntoView({ block: 'nearest' }); }
        break;
      case 'k': case 'ArrowUp':
        e.preventDefault();
        var pv = order[Math.max(0, idx - 1)];
        if (pv) { cursorId = pv.id; if (openId) openDetail(pv.id); else renderAll(); rows[pv.id].el.scrollIntoView({ block: 'nearest' }); }
        break;
      case 'Enter': if (cursorId && !openId) { e.preventDefault(); openDetail(cursorId); } break;
      case ' ': if (cur) { e.preventDefault(); togglePause(cur); } break;
      case 's': case 'S': if (openId) { e.preventDefault(); $('ctrl-steer').click(); } break;
      case 't': case 'T': if (cur) { e.preventDefault(); toggleTake(cur); } break;
      case '?': openDialog('keys-sheet'); break;
    }
  });

  /* ------------------------------------------------------------------ go */
  $('toast').hidden = true;
  seed();
  renderAll();
  setInterval(tick, 250);
})();
