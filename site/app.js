// Interactive figures for the auto-effort story. All numbers come from window.DATA (site/build_data.py).
const D = window.DATA
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const rank = l => LEVELS.indexOf(l)
const PAINT = { low: '#7a9e7e', medium: '#d6a84a', high: '#cd6e48', xhigh: '#b03a42', max: '#6e4880' }
const INK = '#2a2522', SOFT = '#5d544d', RULE = '#d9cfbd'
const NAMES = {
  '01-question': 'Answer a question', '02-typo': 'Fix a typo', '03-rename': 'Rename a function',
  '04-cli-flag': 'Add a CLI flag', '05-pagination': 'Lost last page', '06-validation': 'Validate withdrawals',
  '07-timezone': 'Timezone bug', '08-lru': 'Write an LRU cache', '09-refactor': 'Merge drifting rules',
  '10-concurrency': 'Racy counter', '11-evaluator': 'Expression evaluator', '12-money': 'Off by a cent',
  '13-free-slots': 'Free calendar slots', '14-stale-stock': 'Stale stock cache', '15-csv': 'CSV parser',
  '16-build-order': 'Build order',
}

const $ = (sel, root = document) => root.querySelector(sel)
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (n.className = v) : k.startsWith('on') ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v)
  for (const k of kids.flat()) n.append(k instanceof Node ? k : document.createTextNode(k))
  return n
}
const SVGNS = 'http://www.w3.org/2000/svg'
const sv = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  if (text !== undefined) n.textContent = text
  return n
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const sum = xs => xs.reduce((a, b) => a + b, 0)
const fmt = n => Math.round(n).toLocaleString('en-US')
const pct = (a, b) => (b - a) / a
const signed = x => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(Math.round(x * 100))}%`
const mode = xs => {
  const c = {}
  xs.forEach(x => (c[x] = (c[x] || 0) + 1))
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]
}
const clock = at => new Date(at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' }).replace(' ', '')
const pressGroup = (group, button) => group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)))

// ---------- what Jev picked for each benchmark task, from the runs where it could raise and lower ----------
function taskPicks() {
  const out = {}
  for (const run of ['medium', 'harder']) {
    for (const r of D.runs[run]) {
      if (r.arm !== 'on' || !r.efforts.length) continue
      ;(out[r.task] ||= []).push(r.efforts[0])
    }
  }
  return Object.fromEntries(Object.entries(out).map(([t, firsts]) => [t, { pick: mode(firsts), varies: new Set(firsts).size > 1, firsts }]))
}
const PICKS = taskPicks()

// ---------- I. the ledger ----------
function ledger() {
  const root = $('#ledger')
  const rows = []
  const add = (src, text, pick, note, chat) => {
    const fill = el('div', { class: 'fill' })
    const tag = el('div', { class: 'tag' })
    const row = el('div', { class: 'ledger-row' },
      el('div', { class: 'src' }, src),
      el('div', { class: 'text' + (chat ? ' chat' : ''), title: text }, chat ? `“${text}”` : text),
      el('div', { class: 'meter' }, fill, tag))
    rows.push({ fill, tag, pick, note })
    root.append(row)
  }
  root.append(el('div', { class: 'ledger-group' }, 'Benchmark tasks'))
  for (const [task, prompt] of Object.entries(D.prompts)) {
    const p = PICKS[task]
    if (!p) continue
    const s = D.jevTasks[task]
    const note = p.varies ? `${p.firsts.join(' · ')}` : s ? `score ${s.score.toFixed(2)}` : ''
    add(task.slice(0, 2), prompt, p.pick, note)
  }
  root.append(el('div', { class: 'ledger-group' }, 'From the chat that built this mod'))
  for (const c of D.chat) add(clock(c.at), c.prompt, c.pick, `score ${c.score.toFixed(2)}`, true)

  const paint = mode => rows.forEach(({ fill, tag, pick, note }, i) => {
    const level = mode === 'jev' ? pick : 'high'
    const w = ((rank(level) + 1) / 5) * 62
    setTimeout(() => {
      fill.style.width = w + '%'
      fill.style.backgroundImage = `url(art/swatch-${level}.jpg)`
      tag.style.left = `calc(${w}% + 10px)`
      tag.innerHTML = ''
      tag.append(level, mode === 'jev' && note ? el('small', {}, note) : '')
    }, mode === 'jev' ? i * 28 : 0)
  })
  const group = $('.ledger-figure .toggle')
  group.addEventListener('click', e => {
    const b = e.target.closest('button')
    if (!b) return
    pressGroup(group, b)
    paint(b.dataset.mode)
  })
  paint('fixed')
}

// ---------- II. latency ----------
function latency() {
  const ms = D.latency, left = 20, right = 980, max = 3200, W = 1000
  const tallest = Math.max(...Object.values(ms.reduce((b, v) => ((b[Math.floor(v / 40)] = (b[Math.floor(v / 40)] || 0) + 1), b), {})))
  const base = 80 + tallest * 9, H = base + 40
  const x = v => left + (Math.min(v, max) / max) * (right - left)
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Dot plot of Jev response times' })
  // the timeout zone
  svg.append(sv('rect', { x: x(3000), y: 10, width: right - x(3000), height: base - 10, fill: 'rgba(176,58,66,.08)' }))
  svg.append(sv('line', { x1: x(3000), x2: x(3000), y1: 10, y2: base, stroke: PAINT.xhigh, 'stroke-dasharray': '3 3' }))
  svg.append(sv('text', { x: x(3000) - 8, y: 24, 'text-anchor': 'end', class: 'annot' }, '3 s: the mod stops waiting'))
  svg.append(sv('text', { x: x(3000) - 8, y: 40, 'text-anchor': 'end', class: 'annot-soft' }, `${D.timeouts} calls ended here`))
  // dots stacked in 40 ms bins
  const bins = {}
  ms.forEach((v, i) => {
    const b = Math.floor(v / 40)
    const k = (bins[b] = (bins[b] || 0) + 1)
    const dot = sv('circle', { cx: x(b * 40 + 20), cy: base - 5 - (k - 1) * 9, r: 4, fill: PAINT.indigo || '#3e547a', opacity: 0 })
    dot.style.transition = `opacity .4s ${i * 6}ms`
    dot.classList.add('lat-dot')
    svg.append(dot)
  })
  const p = q => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))]
  for (const [q, label, y] of [[0.5, 'median', 20], [0.9, '9 in 10 within', 44]]) {
    const v = p(q)
    svg.append(sv('line', { x1: x(v), x2: x(v), y1: y - 12, y2: base, stroke: INK, 'stroke-width': 1 }))
    svg.append(sv('text', { x: x(v) + 6, y, class: 'annot' }, `${label} ${fmt(v)} ms`))
  }
  const axis = sv('g', { class: 'axis' })
  axis.append(sv('line', { x1: left, x2: right, y1: base + 1, y2: base + 1 }))
  for (let t = 0; t <= 3000; t += 500) {
    axis.append(sv('line', { x1: x(t), x2: x(t), y1: base + 1, y2: base + 6 }))
    axis.append(sv('text', { x: x(t), y: base + 22, 'text-anchor': 'middle' }, t === 0 ? '0' : `${t / 1000} s`))
  }
  svg.append(axis)
  $('#latency').append(svg)
  $('#latency-caption').textContent =
    `${ms.length} answers from Jev, one dot each. ${D.timeouts} of ${D.decisions} calls ran past three seconds; those turns kept the session’s own effort. ` +
    `The fastest answer took ${fmt(ms[0])} ms, the slowest ${fmt(ms[ms.length - 1])} ms.`
  onSeen(svg, () => svg.querySelectorAll('.lat-dot').forEach(d => d.setAttribute('opacity', 0.75)))
}

// ---------- III. the band ----------
function simulator() {
  const SAMPLES = [
    ...['Reply with just OK.', 'how to do option 1 when claude run in other project dir', 'make the html interactive', 'yes, make it', 'go']
      .map(p => D.chat.find(c => c.prompt === p)).filter(Boolean),
    ...['01-question', '02-typo', '05-pagination', '12-money']
      .filter(t => D.jevTasks[t]).map(t => ({ prompt: D.prompts[t], ...D.jevTasks[t] })),
  ]
  const state = { session: 'high', raise: false, off: false, j: null, timer: [] }
  const band = $('#term-band'), log = $('#term-log'), input = $('#term-input')

  const span = (cls, text) => el('span', { class: cls }, text)
  const applied = pick => (!state.raise && rank(pick) > rank(state.session) ? state.session : pick)
  const render = () => {
    band.innerHTML = ''
    const toggle = el('button', { class: 'btn', type: 'button', onclick: () => { state.off = !state.off; state.j = null; render() } }, state.off ? 'Turn on' : 'Turn off')
    const parts = [span('', '» auto-effort ')]
    const sessionText = `session effort ${state.session.toUpperCase()}`
    const j = state.j
    if (state.off) parts.push(span('muted', `off · ${sessionText} applies `))
    else if (!j) parts.push(span('muted', `on · ${sessionText} until the next prompt `))
    else if (j.phase === 'asking') parts.push(span('muted', `◌ asking Jev... (replaying its recorded ${Math.round(j.ms)}ms) `))
    else {
      const use = applied(j.pick)
      const n = rank(use) + 1
      const note = (j.from === use ? '' : `  (was ${j.from})`) + (use === j.pick ? '' : `  (Jev: ${j.pick}, capped)`)
      parts.push(span(`c-${use}`, '▰'.repeat(n) + '▱'.repeat(5 - n)), el('b', { class: `c-${use}` }, ` effort ${use.toUpperCase()}`))
      parts.push(j.sent ? span('ok', ' ✓ sent') : span('muted', ' · not sent yet'))
      parts.push(span('muted', `${note} · Jev ${Math.round(j.confidence * 100)}% sure · ${Math.round(j.ms)}ms `))
    }
    band.append(...parts, toggle)
  }
  const send = s => {
    state.timer.forEach(clearTimeout)
    state.timer = []
    const lines = [...log.children].slice(-3)
    log.innerHTML = ''
    log.append(...lines)
    input.textContent = ''
    // type the prompt, then submit it
    const text = s.prompt.length > 120 ? s.prompt.slice(0, 117) + '…' : s.prompt
    const typing = Math.min(900, text.length * 14)
    ;[...text].forEach((ch, i) => state.timer.push(setTimeout(() => (input.textContent += ch), (i * typing) / text.length)))
    state.timer.push(setTimeout(() => {
      input.textContent = ''
      log.append(el('div', { class: 'you' }, text))
      if (state.off) {
        log.append(el('div', { class: 'dim' }, `  thinking at ${state.session}…`))
        state.j = null
        return render()
      }
      state.j = { phase: 'asking', ms: s.ms }
      render()
      state.timer.push(setTimeout(() => {
        state.j = { phase: 'picked', pick: s.pick, confidence: s.confidence, ms: s.ms, from: state.session }
        render()
        state.timer.push(setTimeout(() => {
          state.j.sent = true
          render()
          log.append(el('div', { class: 'dim' }, `  thinking at ${applied(s.pick)}…`))
        }, 450))
      }, s.ms))
    }, typing + 250))
  }

  const chips = $('#sim-prompts')
  SAMPLES.forEach(s => chips.append(el('button', { type: 'button', 'aria-pressed': 'false', title: s.prompt, onclick: e => { pressGroup(chips, e.currentTarget); send(s) } },
    s.prompt.length > 46 ? s.prompt.slice(0, 44) + '…' : s.prompt)))
  const seg = $('#sim-session')
  LEVELS.forEach(l => seg.append(el('button', { type: 'button', 'aria-pressed': String(l === state.session), onclick: e => {
    pressGroup(seg, e.currentTarget)
    state.session = l
    if (state.j?.phase === 'picked') state.j.from = l
    render()
  } }, l)))
  $('#sim-raise').addEventListener('change', e => { state.raise = e.target.checked; render() })
  log.append(el('div', { class: 'dim' }, 'Claude Code · auto-effort loaded'))
  render()
  // start with a demonstration once the reader gets here
  onSeen($('.terminal'), () => chips.querySelector('button:nth-child(4)')?.click())
}

// ---------- III. four times "yes" ----------
function yesChart() {
  const W = 1000, H = 230, left = 30, right = 970, y0 = 120
  const x = s => left + (s / 4) * (right - left)
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Scores Jev gave the word yes' })
  LEVELS.forEach((l, i) => {
    const a = Math.max(0, i - 0.5), b = Math.min(4, i + 0.5)
    svg.append(sv('rect', { x: x(a), y: y0 - 18, width: x(b) - x(a), height: 36, fill: PAINT[l], opacity: 0.22 }))
    svg.append(sv('text', { x: (x(a) + x(b)) / 2, y: y0 + 40, 'text-anchor': 'middle', class: 'annot-soft' }, l))
  })
  svg.append(sv('line', { x1: left, x2: right, y1: y0, y2: y0, stroke: INK }))
  for (let t = 0; t <= 4; t++) svg.append(sv('text', { x: x(t), y: y0 + 62, 'text-anchor': 'middle', class: 'annot-soft' }, String(t)))

  const before = D.chat.find(c => c.prompt === 'yes, fix')
  const yeses = D.chat.filter(c => c.prompt === 'yes')
  if (before) {
    svg.append(sv('circle', { cx: x(before.score), cy: y0, r: 9, fill: 'none', stroke: SOFT, 'stroke-width': 2, 'stroke-dasharray': '3 2' }))
    svg.append(sv('line', { x1: x(before.score), x2: x(before.score), y1: y0 + 10, y2: 190, stroke: SOFT, 'stroke-dasharray': '2 3' }))
    svg.append(sv('text', { x: x(before.score) + 6, y: 205, class: 'annot-soft' }, `“yes, fix” before the fix: ${before.score.toFixed(2)}`))
  }
  yeses.forEach((c, i) => {
    const cx = x(c.score), ty = 26 + (i % 2) * 34
    svg.append(sv('line', { x1: cx, x2: cx, y1: ty + 6, y2: y0 - 10, stroke: INK, 'stroke-width': 0.8 }))
    svg.append(sv('circle', { cx, cy: y0, r: 9, fill: PAINT[c.pick], stroke: INK, 'stroke-width': 1.2 }))
    const capped = c.applies !== c.pick ? `, ran at ${c.applies}` : ''
    svg.append(sv('text', { x: cx + 6, y: ty, class: 'annot' }, `${c.score.toFixed(2)} · ${c.pick}${capped}`))
    svg.append(sv('text', { x: cx + 6, y: ty + 15, class: 'annot-soft' }, `${clock(c.at)}, ${Math.round(c.confidence * 100)}% sure`))
  })
  $('#yes-chart').append(svg)
}

// ---------- IV. the experiment ----------
const totals = (rows, arm, key) => sum(rows.filter(r => r.arm === arm).map(r => r[key]))
const passes = (rows, arm) => rows.filter(r => r.arm === arm && r.pass).length
const count = (rows, arm) => rows.filter(r => r.arm === arm).length

function scoreboard() {
  const rows = D.runs.high
  const cell = (big, what, from, down) => el('div', {}, el('span', { class: 'big' + (down ? ' down' : '') }, big), el('span', { class: 'what' }, what), el('span', { class: 'from' }, from))
  const t = k => [totals(rows, 'off', k), totals(rows, 'on', k)]
  const [to, tn] = t('thinking_tokens'), [oo, on] = t('output_tokens'), [co, cn] = t('cost')
  $('#scoreboard').append(
    cell(signed(pct(to, tn)), 'Thinking tokens', `${fmt(to)} → ${fmt(tn)}`, tn < to),
    cell(signed(pct(oo, on)), 'All output tokens', `${fmt(oo)} → ${fmt(on)}`, on < oo),
    cell(signed(pct(co, cn)), 'Cost', `$${co.toFixed(2)} → $${cn.toFixed(2)}`, cn < co),
    cell(`${passes(rows, 'on')}/${count(rows, 'on')}`, 'Passed, mod on', `against ${passes(rows, 'off')}/${count(rows, 'off')} with it off`),
  )
  // paint.py stacks(): one coin per 400 tokens, 30px each, base at y=1200 on a 1300px sheet
  const top = t => ((1200 - Math.round(t / 400) * 30 - 50) / 1300) * 100 + '%'
  $('#stack-off').textContent = fmt(to)
  $('#stack-on').textContent = fmt(tn)
  $('.stack-label.l').style.top = top(to)
  $('.stack-label.r').style.top = top(tn)
}

// ---------- IV. what the mod did, task by task ----------
const SESSION = { high: 'high', medium: 'medium', harder: 'medium' }
function classify(run) {
  const rows = D.runs[run], session = rank(SESSION[run]), out = {}
  for (const t of new Set(rows.map(r => r.task))) {
    const what = rows.filter(r => r.task === t && r.arm === 'on').map(r => {
      const top = Math.max(...r.efforts.map(rank))
      return top < session ? 'lowered' : top > session ? 'raised' : 'kept'
    })
    out[t] = mode(what)
  }
  return out
}

function split() {
  const rows = D.runs.high, kind = classify('high')
  const groups = ['lowered', 'kept', 'raised'].map(k => {
    const tasks = Object.keys(kind).filter(t => kind[t] === k)
    const of = arm => sum(rows.filter(r => kind[r.task] === k && r.arm === arm).map(r => r.thinking_tokens))
    return { k, tasks, off: of('off'), on: of('on') }
  })
  const label = { lowered: 'Jev lowered the effort', kept: 'Jev kept it at high', raised: 'Jev raised it to xhigh' }
  const W = 1000, rowH = 86, top = 20, left = 250, right = 800, H = top + groups.length * rowH
  const max = Math.max(...groups.flatMap(g => [g.off, g.on]))
  const x = v => left + (v / max) * (right - left)
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Thinking tokens split by what the mod did' })
  groups.forEach((g, i) => {
    const y = top + i * rowH
    const name = sv('text', { x: left - 20, y: y + 20, 'text-anchor': 'end', class: 'annot' }, label[g.k])
    name.append(sv('title', {}, g.tasks.map(t => NAMES[t]).join(', ')))
    svg.append(name)
    svg.append(sv('text', { x: left - 20, y: y + 37, 'text-anchor': 'end', class: 'annot-soft' }, `${g.tasks.length} task${g.tasks.length > 1 ? 's' : ''}`))
    ;[['off', g.off, 'rgba(42,37,34,.18)'], ['on', g.on, PAINT[g.k === 'lowered' ? 'low' : g.k === 'kept' ? 'high' : 'xhigh']]].forEach(([arm, v, fill], j) => {
      const yy = y + 6 + j * 24
      svg.append(sv('rect', { x: left, y: yy, width: Math.max(1, x(v) - left), height: 20, fill, opacity: j ? 0.85 : 1 }))
      svg.append(sv('text', { x: x(v) + 8, y: yy + 15, class: j ? 'annot' : 'annot-soft' }, `${fmt(v)} ${arm === 'off' ? 'mod off' : 'mod on'}`))
    })
    const change = pct(g.off, g.on)
    svg.append(sv('text', { x: W - 4, y: y + 34, 'text-anchor': 'end', class: 'annot', fill: g.k === 'kept' ? SOFT : change < 0 ? '#4f7a54' : PAINT.xhigh }, signed(change)))
  })
  $('#split').append(svg)
  const kept = groups.find(g => g.k === 'kept')
  $('#split-caption').textContent = `Total thinking tokens over three runs per task. A task is grouped by what the mod did in most of its runs. The ${kept.tasks.length} “kept” tasks ran at high in both arms, so their ${signed(pct(kept.off, kept.on))} is run-to-run variation, not the mod.`
}

const DEKS = {
  high: 'Session effort <i>high</i>. Twelve tasks, three runs per arm. Jev mostly lowered; it raised one task to <i>xhigh</i>.',
  medium: 'Session effort <i>medium</i>, and Jev was allowed to raise as well as lower. The same twelve tasks.',
  harder: 'Four tasks written to be harder, session at <i>medium</i>, raising allowed.',
}

function dumbbell() {
  const view = { run: 'high', metric: 'thinking_tokens' }
  const root = $('#dumbbell')
  const draw = () => {
    root.innerHTML = ''
    $('#run-dek').innerHTML = DEKS[view.run]
    const rows = D.runs[view.run]
    const tasks = [...new Set(rows.map(r => r.task))].sort()
    const stat = (t, a) => {
      const rs = rows.filter(r => r.task === t && r.arm === a)
      const efforts = rs.flatMap(r => r.efforts)
      return { v: mean(rs.map(r => r[view.metric])), pass: rs.filter(r => r.pass).length, n: rs.length, effort: efforts.length ? mode(efforts) : null, all: [...new Set(efforts)] }
    }
    const data = tasks.map(t => ({ t, off: stat(t, 'off'), on: stat(t, 'on') }))
    const max = Math.max(...data.flatMap(d => [d.off.v, d.on.v])) * 1.08
    const rowH = 38, top = 34, W = 1000, left = 210, right = 820, H = top + data.length * rowH + 10
    const x = v => left + (v / max) * (right - left)
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Per-task comparison, mod off and on' })
    const unit = { thinking_tokens: v => fmt(v), cost: v => '$' + v.toFixed(2), seconds: v => fmt(v) + ' s' }[view.metric]
    // grid
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i
      svg.append(sv('line', { x1: x(v), x2: x(v), y1: top - 8, y2: H - 6, stroke: RULE, 'stroke-width': 1 }))
      svg.append(sv('text', { x: x(v), y: top - 14, 'text-anchor': 'middle', class: 'annot-soft' }, unit(v)))
    }
    svg.append(sv('text', { x: 900, y: top - 14, 'text-anchor': 'middle', class: 'annot-soft' }, 'change · pass'))
    data.forEach((d, i) => {
      const y = top + i * rowH + rowH / 2
      const g = sv('g')
      g.append(sv('text', { x: left - 16, y: y + 4, 'text-anchor': 'end', class: 'annot' }, NAMES[d.t] || d.t))
      const lower = d.on.v < d.off.v
      g.append(sv('line', { x1: x(d.off.v), x2: x(d.on.v), y1: y, y2: y, stroke: lower ? PAINT.low : PAINT.xhigh, 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.55 }))
      g.append(sv('circle', { cx: x(d.off.v), cy: y, r: 7, fill: '#f6f1e6', stroke: INK, 'stroke-width': 2 }))
      const on = sv('circle', { cx: x(d.on.v), cy: y, r: 8, fill: PAINT[d.on.effort] || SOFT, stroke: INK, 'stroke-width': 1 })
      on.append(sv('title', {}, `mod on ran at ${d.on.all.join(' and ')}`))
      g.append(on)
      g.append(sv('text', { x: x(d.on.v) + (lower ? -14 : 14), y: y - 11, 'text-anchor': lower ? 'end' : 'start', class: 'annot-soft' }, d.on.all.join('/')))
      const change = d.off.v ? pct(d.off.v, d.on.v) : 0
      g.append(sv('text', { x: 880, y: y + 4, 'text-anchor': 'end', class: 'annot', fill: Math.abs(change) < 0.03 ? SOFT : change < 0 ? '#4f7a54' : PAINT.xhigh }, d.off.v ? signed(change) : '–'))
      const passText = `${d.off.pass}/${d.off.n} · ${d.on.pass}/${d.on.n}`
      g.append(sv('text', { x: 900, y: y + 4, class: 'annot' + (d.on.pass < d.on.n ? '' : '-soft'), fill: d.on.pass < d.on.n ? PAINT.xhigh : SOFT }, passText))
      g.style.opacity = 0
      g.style.transition = `opacity .5s ${i * 40}ms`
      svg.append(g)
    })
    root.append(svg)
    requestAnimationFrame(() => requestAnimationFrame(() => svg.querySelectorAll('g').forEach(g => (g.style.opacity = 1))))
  }
  const tabs = (sel, key) => {
    const group = $(sel)
    group.addEventListener('click', e => {
      const b = e.target.closest('button')
      if (!b) return
      pressGroup(group, b)
      view[key] = b.dataset[key]
      draw()
    })
  }
  tabs('#run-tabs', 'run')
  tabs('#metric-tabs', 'metric')
  $('#legend').append(
    el('span', {}, el('i', { class: 'hollow' }), 'mod off'),
    ...LEVELS.slice(0, 4).map(l => el('span', {}, el('i', { style: `background:${PAINT[l]}` }), `mod on, ran at ${l}`)),
  )
  draw()
}

function failureNote() {
  const fails = Object.entries(D.runs).flatMap(([run, rows]) => rows.filter(r => !r.pass).map(r => ({ ...r, exp: run })))
  const high = fails.find(f => f.exp === 'high')
  if (!high) return
  const same = fails.filter(f => f.task === high.task)
  const tries = Object.values(D.runs).flat().filter(r => r.task === high.task && r.arm === 'on').length
  const other = same.find(f => f !== high)
  $('#failure-note').innerHTML =
    `In the <i>high</i> experiment, one of the 36 mod-on runs failed its hidden test: “${NAMES[high.task]}”, a task that asks for an arithmetic parser written from scratch. ` +
    `The mod hadn’t lowered that run. Jev picked <i>${high.efforts.join(', ')}</i>, so it ran at exactly the effort the mod-off arm did. ` +
    (other ? `The same task failed once more in the <i>${other.exp}</i> experiment, where the mod had <i>raised</i> it to ${other.efforts.join(', ')}. ` : '') +
    `${same.length} failures in ${tries} mod-on attempts, on one task, at the same effort or higher: that is this task’s run-to-run variance, not the mod lowering effort. ` +
    `Across all ${Object.values(D.runs).flat().length} runs, no other task failed.`
}

// ---------- V. raising ----------
function deltas() {
  const exps = [
    ['high', 'From high'],
    ['medium', 'From medium'],
    ['harder', 'Harder tasks, from medium'],
  ].map(([k, label]) => {
    const r = D.runs[k]
    return {
      label,
      thinking: pct(totals(r, 'off', 'thinking_tokens'), totals(r, 'on', 'thinking_tokens')),
      cost: pct(totals(r, 'off', 'cost'), totals(r, 'on', 'cost')),
      pass: `${passes(r, 'off')}/${count(r, 'off')} → ${passes(r, 'on')}/${count(r, 'on')}`,
    }
  })
  const W = 1000, rowH = 92, top = 36, H = top + exps.length * rowH, left = 360, right = 820
  const lo = -0.5, hi = 1.25
  const x = v => left + ((v - lo) / (hi - lo)) * (right - left)
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Change in thinking and cost per experiment' })
  for (const v of [-0.5, 0, 0.5, 1]) {
    svg.append(sv('line', { x1: x(v), x2: x(v), y1: top - 10, y2: H - 8, stroke: v === 0 ? INK : RULE }))
    svg.append(sv('text', { x: x(v), y: top - 16, 'text-anchor': 'middle', class: 'annot-soft' }, v === 0 ? 'no change' : signed(v)))
  }
  svg.append(sv('text', { x: 940, y: top - 16, 'text-anchor': 'middle', class: 'annot-soft' }, 'passed'))
  exps.forEach((e, i) => {
    const y = top + i * rowH + 18
    svg.append(sv("text", { x: 190, y: y + 18, "text-anchor": "end", class: "annot" }, e.label))
    ;[['thinking', 'thinking'], ['cost', 'cost']].forEach(([k, name], j) => {
      const v = e[k], yy = y + j * 26
      const bar = sv('rect', { x: Math.min(x(0), x(v)), y: yy, width: 0, height: 20, fill: v < 0 ? PAINT.low : PAINT.high, opacity: j ? 0.95 : 0.6 })
      bar.dataset.w = Math.abs(x(v) - x(0))
      bar.dataset.x = Math.min(x(0), x(v))
      bar.style.transition = 'width 1s cubic-bezier(.2,.8,.2,1), x 1s cubic-bezier(.2,.8,.2,1)'
      if (v < 0) bar.setAttribute('x', x(0))
      svg.append(bar)
      svg.append(sv('text', { x: v < 0 ? x(v) - 8 : x(v) + 8, y: yy + 15, 'text-anchor': v < 0 ? 'end' : 'start', class: 'annot' }, `${name} ${signed(v)}`))
    })
    svg.append(sv('text', { x: 940, y: y + 30, 'text-anchor': 'middle', class: 'annot' }, e.pass))
  })
  $('#deltas').append(svg)
  onSeen(svg, () => svg.querySelectorAll('rect[data-w]').forEach(b => { b.setAttribute('width', b.dataset.w); b.setAttribute('x', b.dataset.x) }))
}

// ---------- VI. cache ----------
function cache() {
  const { changed, same } = D.cache
  const cell = ([hit, n], what) => {
    const bar = el('i')
    const div = el('div', {},
      el('div', { class: 'big' }, `${(100 * hit / n).toFixed(1)}%`),
      el('div', { class: 'what' }, what, el('br'), `${fmt(hit)} of ${fmt(n)} requests`),
      el('div', { class: 'bar' }, bar))
    onSeen(div, () => (bar.style.width = (100 * hit / n) + '%'))
    return div
  }
  $('#cache-compare').append(
    cell(changed, 'of requests sent right after the effort changed read over 95% of their input from cache'),
    cell(same, 'of requests with the effort unchanged did the same'),
  )
  const note = el('figcaption', {}, 'Main-conversation requests with over 5,000 tokens of input, sent within five minutes of the one before (the cache’s lifetime), across every Claude Code session on this machine. Thirty-two effort changes is a small sample.')
  $('#cache-compare').after(note)
}

// ---------- reveal on scroll ----------
function onSeen(node, fn) {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.disconnect(); fn() } }), { threshold: 0.3 })
  io.observe(node)
}
function reveals() {
  // figures with paintings stay put: an opacity or translate transition would stop them multiplying onto the paper
  document.querySelectorAll('main figure:not(.inset):not(.stacks):not(.shelf), .question-card, .note, .scoreboard, .anatomy, .cache-compare, .install').forEach(n => {
    n.classList.add('reveal')
    onSeen(n, () => n.classList.add('in'))
  })
}

ledger()
latency()
simulator()
yesChart()
scoreboard()
split()
dumbbell()
failureNote()
deltas()
cache()
reveals()
