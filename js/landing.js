/* ==========================================================================
   Done. — landing behaviour
   Nothing on this page moves unless it's telling you something.
   ========================================================================== */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var CIRC = 50.27; // 2πr where r = 8
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Dot factory (shared shape language) ---------- */
  function makeDot(state, progress) {
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
    setDot(svg, state, progress);
    return svg;
  }
  function setDot(svg, state, progress) {
    svg.setAttribute('data-state', state);
    var arc = svg.querySelector('.dot-arc');
    arc.style.strokeDashoffset = String(CIRC * (1 - Math.max(0, Math.min(1, progress || 0))));
  }

  /* ---------- Header hairline on scroll ---------- */
  var header = document.getElementById('site-header');
  function onScroll() { header.classList.toggle('is-scrolled', window.scrollY > 12); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Reveal on view ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el, i) {
      // gentle stagger only inside the hero
      if (el.closest('.hero')) el.style.transitionDelay = (i * 90) + 'ms';
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ==========================================================================
     Hero — a list that plays itself.
     Each task is a script of (state, progress, sentence) beats.
     ========================================================================== */
  var heroList = document.getElementById('hero-list');
  var heroCount = document.getElementById('hero-count');
  var heroTyping = document.getElementById('hero-typing');

  var scripts = [
    {
      title: 'Find a plumber for the kitchen sink',
      beats: [
        ['working', 0.18, 'Looking for plumbers near you with good reviews.'],
        ['working', 0.4, 'Three can come tomorrow. Comparing prices.'],
        ['snag', 0.48, 'One site wouldn’t load. Calling their number instead.'],
        ['working', 0.7, 'Northside Plumbing can do 9am for $120.'],
        ['needs', 0.82, 'Ready to book. Waiting for your okay.'],
        ['working', 0.92, 'You said yes. Booking now.'],
        ['done', 1, 'Booked for tomorrow, 9am. Added to your calendar.']
      ]
    },
    {
      title: 'Get a refund for the cracked phone case',
      beats: [
        ['working', 0.22, 'Found the order from March 14.'],
        ['working', 0.5, 'Started a return. It qualifies for a full refund.'],
        ['working', 0.78, 'Printed label saved to your files.'],
        ['done', 1, 'Refund of $24 is on its way.']
      ]
    },
    {
      title: 'Move my Thursday call with Priya to next week',
      beats: [
        ['working', 0.3, 'Checking when you’re both free next week.'],
        ['working', 0.6, 'Tuesday at 3pm works for both of you.'],
        ['working', 0.85, 'Sent Priya a short note asking if Tuesday works.'],
        ['done', 1, 'Priya said yes. Moved to Tuesday, 3pm.']
      ]
    }
  ];
  var newTask = {
    title: 'Renew my passport before the trip',
    beats: [
      ['working', 0.15, 'Checking what you need to renew online.'],
      ['working', 0.35, 'You can renew online. Filling in the form.'],
      ['needs', 0.5, 'Needs a new photo. Can you take one?']
    ]
  };

  var rows = [];

  function buildRow(task) {
    var li = document.createElement('li');
    li.className = 'sheet-item';
    var dot = makeDot('waiting', 0);
    var title = document.createElement('span');
    title.className = 'sheet-title';
    title.textContent = task.title;
    var line = document.createElement('span');
    line.className = 'sheet-line';
    line.textContent = 'Waiting to start.';
    li.appendChild(dot); li.appendChild(title); li.appendChild(line);
    li.setAttribute('data-state', 'waiting');
    return { el: li, dot: dot, line: line, task: task, step: -1 };
  }

  function applyBeat(row, beat) {
    var state = beat[0], p = beat[1], text = beat[2];
    setDot(row.dot, state, p);
    row.el.setAttribute('data-state', state);
    // crossfade the sentence: say one thing at a time
    row.line.classList.add('is-swapping');
    setTimeout(function () {
      row.line.textContent = text;
      row.line.classList.remove('is-swapping');
    }, 260);
  }

  function updateCount() {
    var going = rows.filter(function (r) { return r.el.getAttribute('data-state') !== 'done'; }).length;
    var needs = rows.filter(function (r) { return r.el.getAttribute('data-state') === 'needs'; }).length;
    var txt;
    if (going === 0) txt = 'All done. Nothing needs you.';
    else if (needs) txt = needs + ' needs you · ' + (going - needs) + ' going';
    else txt = going + ' of ' + rows.length + ' still going';
    heroCount.textContent = txt;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function typeInto(el, text) {
    el.textContent = '';
    el.classList.add('is-typing');
    var i = 0;
    return new Promise(function (resolve) {
      (function tick() {
        if (i <= text.length) {
          el.textContent = text.slice(0, i);
          i++;
          setTimeout(tick, 34 + Math.random() * 46);
        } else resolve();
      })();
    });
  }

  async function runHero() {
    heroList.innerHTML = '';
    rows = scripts.map(buildRow);
    rows.forEach(function (r) { heroList.appendChild(r.el); });
    heroTyping.textContent = 'What needs doing?';
    heroTyping.classList.remove('is-typing');
    updateCount();
    await sleep(1400);

    // interleave beats — like real parallel work, never all at once
    var timeline = [
      [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2], [2, 1], [0, 3],
      [1, 2], [0, 4], [2, 2], [1, 3], [0, 5], [2, 3], [0, 6]
    ];
    for (var k = 0; k < timeline.length; k++) {
      var t = timeline[k];
      var row = rows[t[0]];
      applyBeat(row, row.task.beats[t[1]]);
      updateCount();
      await sleep(row.task.beats[t[1]][0] === 'needs' ? 2600 : 1500);
    }

    await sleep(1200);
    // Someone writes a new thing
    await typeInto(heroTyping, newTask.title);
    await sleep(500);
    var nr = buildRow(newTask);
    nr.el.classList.add('is-entering');
    heroList.appendChild(nr.el);
    rows.push(nr);
    heroTyping.textContent = 'What needs doing?';
    heroTyping.classList.remove('is-typing');
    requestAnimationFrame(function () { nr.el.classList.remove('is-entering'); });
    updateCount();
    await sleep(1100);
    for (var b = 0; b < newTask.beats.length; b++) {
      applyBeat(nr, newTask.beats[b]);
      updateCount();
      await sleep(1700);
    }
    await sleep(4200);
    // Fade and loop
    heroList.style.transition = 'opacity 900ms';
    heroList.style.opacity = '0';
    await sleep(950);
    heroList.style.opacity = '1';
    runHero();
  }

  if (heroList) {
    if (reduce) {
      rows = scripts.map(buildRow);
      rows.forEach(function (r) { heroList.appendChild(r.el); applyBeat(r, r.task.beats[r.task.beats.length - 1]); });
      updateCount();
    } else {
      runHero();
    }
  }

  /* ---------- Language: show what's underneath ---------- */
  var toggle = document.getElementById('machinery-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var on = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(on));
      toggle.closest('.narration').classList.toggle('show-machinery', on);
      toggle.querySelector('.switch-label').textContent = on ? 'Hide what’s underneath' : 'Show what’s underneath';
    });
  }

  /* ---------- Ask card: try it ---------- */
  var askCard = document.getElementById('ask-demo');
  var askResult = document.getElementById('ask-result');
  if (askCard) {
    var replies = {
      yes: 'Booked. You’ll get a reminder Friday evening.',
      other: 'Got it. Looking at Sunday and early next week.',
      later: 'Okay. I’ll hold the slot until 6pm and ask again.'
    };
    askCard.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ask]');
      if (!btn) return;
      var key = btn.getAttribute('data-ask');
      var dot = askCard.querySelector('.dot');
      askResult.style.opacity = '0';
      setTimeout(function () {
        askResult.textContent = replies[key];
        askResult.style.opacity = '1';
      }, 180);
      if (key === 'yes') {
        dot.setAttribute('data-state', 'done');
        askCard.querySelector('header span').textContent = 'Done · Dentist';
        askCard.querySelector('header').style.color = 'var(--text-2)';
      } else {
        dot.setAttribute('data-state', 'working');
        askCard.querySelector('header span').textContent = key === 'other' ? 'On it · Dentist' : 'Paused · Dentist';
        askCard.querySelector('header').style.color = 'var(--text-3)';
      }
    });
  }

  /* ---------- Recovery: steps light up as you arrive ---------- */
  var rec = document.getElementById('recovery-demo');
  if (rec && 'IntersectionObserver' in window) {
    var lit = false;
    var ro = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !lit) {
        lit = true;
        Array.prototype.forEach.call(rec.children, function (li, i) {
          setTimeout(function () { li.classList.add('is-lit'); }, reduce ? 0 : 500 + i * 1100);
        });
      }
    }, { threshold: 0.4 });
    ro.observe(rec);
  } else if (rec) {
    Array.prototype.forEach.call(rec.children, function (li) { li.classList.add('is-lit'); });
  }

  /* ---------- Final form: carry the thought into the demo ---------- */
  var form = document.getElementById('final-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      var input = document.getElementById('final-input');
      if (!input.value.trim()) {
        e.preventDefault();
        input.value = input.placeholder;
        form.submit();
      }
    });
  }
})();
