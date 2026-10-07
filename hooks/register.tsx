import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Effort, Judgement } from '../types'

const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const TIMEOUT_MS = 3000
const LOG_LINES = 1000
const REPORT_TURNS = 12
// A fresh TLS connection to Jev costs ~550ms on top of its ~250ms answer, and an idle one is dropped within a few
// minutes. So while the session is in use, an unauthenticated HEAD (a free 405) keeps the host's connection open.
const WARM_EVERY_MS = 60_000
const WARM_IDLE_MS = 15 * 60_000
// Where a prompt a person wrote comes from: typed, Remote Control, `claude -p`, a /loop or routine, a chat channel,
// or a channel the engine can't attest. Every other origin is model- or agent-authored.
const PERSON_ORIGINS = new Set<string | undefined>(['composer', 'bridge', 'sdk', 'scheduled-trigger', 'channel', 'unclassified'])
const LEVELS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const COLORS: Record<Effort, string> = { low: 'green', medium: 'cyan', high: 'blue', xhigh: 'magenta', max: 'red' }

const judgement = atom({ plugin: 'auto-effort', key: 'judgement' } as const, null)
const isOff = atom({ plugin: 'auto-effort', key: 'isOff' } as const, false)
const previous = atom({ plugin: 'auto-effort', key: 'previous' } as const, null)
const sessionEffort = atom({ plugin: 'auto-effort', key: 'sessionEffort' } as const, null)
const queued = atom({ plugin: 'auto-effort', key: 'queued' } as const, null)
const run = atom({ plugin: 'auto-effort', key: 'run' } as const, null)
const lastReply = atom({ plugin: 'auto-effort', key: 'lastReply' } as const, null)

// One Score question; its criteria are ordered like LEVELS, so round(score) indexes it.
const QUESTION = {
  type: 'score',
  instructions:
    'How much reasoning effort does a coding agent need for `request`? A short follow-up ("yes", "do it", "1", "continue") approves or continues the work proposed in `last_reply` or asked for in `previous_request`.',
  criteria: [
    'Trivial: a quick question, a lookup, or a one-line edit',
    'Small: a focused change in one or two files',
    'Moderate: a feature or bug fix across several files, a non-obvious bug, or running a multi-step workflow such as a code review',
    'Hard: a cross-cutting refactor, tricky concurrency/security/performance work, or debugging with little to go on',
    'Very hard: architecture or algorithm design where a wrong call is expensive',
  ],
}

// Resolves `work`, or null once `ms` pass. Only a real timeout wins: the abort after the race settles nothing.
// ponytail: $.http.fetch takes no signal, so a timed-out request runs on and is ignored
function withTimeout<T>($: EngineInterface, ms: number, work: Promise<T>): Promise<T | null> {
  const stop = new AbortController()
  const timeout = $.clock.sleep(ms, { signal: stop.signal }).then(() => null, () => new Promise<never>(() => {}))
  return Promise.race([work, timeout]).finally(() => stop.abort())
}

// ponytail: module-level, reset by a reload; at worst one prompt pays the handshake again
let lastActive = 0
let warming: unknown = null

async function warm($: EngineInterface) {
  if (!(await $.env.get('TYPESAFE_API_KEY')) || (await read($, isOff))) return
  await $.http.fetch(JEV_URL, { method: 'HEAD' }).catch(() => {})
}

// The session is in use: keep Jev's connection open until it has been idle for WARM_IDLE_MS.
// Started by the first sign of use, so a mod loaded into a running session warms too.
async function active($: EngineInterface) {
  lastActive = await $.clock.now()
  warming ??= $.clock.every(WARM_EVERY_MS, async () => {
    if ((await $.clock.now()) - lastActive < WARM_IDLE_MS) await warm($)
  })
}

async function judge($: EngineInterface, text: string, before: string | null, reply: string | null): Promise<Judgement> {
  const key = await $.env.get('TYPESAFE_API_KEY')
  if (!key) return { phase: 'kept', reason: 'no TYPESAFE_API_KEY' }

  const startedAt = await $.clock.now()
  const res = await withTimeout($, TIMEOUT_MS, $.http.fetch(JEV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    // ponytail: chars not tokens; 4k + 1.5k + 16k chars stays well under Jev's 32k-token state budget
    body: JSON.stringify({
      model: 'jev-latest',
      state: { previous_request: before?.slice(0, 4000) ?? null, last_reply: reply, request: text.slice(0, 16000) },
      questions: { effort: QUESTION },
    }),
  }))
  if (!res) return { phase: 'kept', reason: `Jev timed out (${TIMEOUT_MS / 1000}s)` }
  if (!res.ok) return { phase: 'kept', reason: `Jev HTTP ${res.status}` }

  const { score, confidence } = JSON.parse(res.text).answers?.effort ?? {}
  // ponytail: round to the nearest level; a split answer (2.51) flips between neighbours
  const pick = typeof score === 'number' && typeof confidence === 'number' ? LEVELS[Math.round(score)] : undefined
  if (!pick) return { phase: 'kept', reason: 'Jev gave no score' }
  return { phase: 'picked', pick, score, confidence, ms: (await $.clock.now()) - startedAt }
}

// One JSON line per judged prompt, for monitoring; outside the mod folder so writing it never reloads the mod.
// ponytail: read-rewrite of the whole file (fs has no append), capped at LOG_LINES
async function logPath($: EngineInterface) {
  return `${await $.env.get('HOME')}/.claude/auto-effort/decisions.jsonl`
}

async function log($: EngineInterface, entry: object) {
  const path = await logPath($)
  const old = await $.fs.read(path).catch(() => '')
  const lines = [...old.split('\n').filter(Boolean), JSON.stringify(entry)].slice(-LOG_LINES)
  await $.fs.write(path, lines.join('\n') + '\n')
}

// The /auto-effort report: the last turns (all sessions), newest last, with what Jev picked and what ran.
export function report(logText: string): string {
  const turns = logText.split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.kind === 'turn').slice(-REPORT_TURNS)
  if (!turns.length) return 'auto-effort: no turns logged yet.'
  const level = (x: unknown) => LEVELS.indexOf(x as Effort)
  const moved = { lowered: 0, raised: 0, same: 0 }
  const rows = turns.map(t => {
    const ran = (t.efforts as unknown[]).map(String).join('/') || '-'
    const top = Math.max(...(t.efforts as unknown[]).map(level))
    if (t.session !== undefined && t.efforts.length) {
      const d = top - level(t.session)
      moved[d < 0 ? 'lowered' : d > 0 ? 'raised' : 'same']++
    }
    const jev = t.jev === 'off' ? 'off'
      : t.jev?.phase === 'picked' ? `${t.jev.pick} ${t.jev.score.toFixed(2)} (${Math.round(t.jev.confidence * 100)}%)`
      : t.jev?.phase === 'kept' ? t.jev.reason : '-'
    return `${ran.padEnd(14)}${String(t.session ?? '-').padEnd(9)}${String(t.requests).padStart(4)}${String(t.outputTokens).padStart(8)}  ${jev.padEnd(28)}${String(t.prompt).replace(/\s+/g, ' ').slice(0, 50)}`
  })
  return [
    `auto-effort, last ${turns.length} turns: ${moved.lowered} lowered, ${moved.raised} raised, ${moved.same} unchanged vs the session's effort`,
    '',
    `${'ran at'.padEnd(14)}${'session'.padEnd(9)}${'reqs'.padStart(4)}${'out tok'.padStart(8)}  ${'jev'.padEnd(28)}prompt`,
    ...rows,
  ].join('\n')
}

// The effort a pick runs at: capped at the session's own effort unless raising is allowed.
function applied(pick: Effort, session: unknown, canRaise: boolean): Effort {
  const cap = LEVELS.indexOf(session as Effort)
  return !canRaise && cap >= 0 && LEVELS.indexOf(pick) > cap ? LEVELS[cap]! : pick
}

export const register: Register = (on, options) => {
  // Benchmarks (bench/) found raising cost 4-15% more with no change in pass rate, so it's opt-in.
  const canRaise = options.raise === true

  // Grade the prompt before it enters, so the turn's first request already uses the pick.
  on('prompt.submit', async ($, e, next) => {
    // Only requests a person wrote are judged. A subagent's report, a task notification or a peer's message
    // continues the work already running: it keeps the current pick and isn't the "previous request" either.
    if (!PERSON_ORIGINS.has(e.origin?.kind)) return next(e)
    await active($)
    // Typed during a running turn (e.turnId): with ctrl+x enter (e.wait) it waits to run as its own turn, so its
    // pick waits too and turn.start applies it; otherwise it's an aside delivered into the running task.
    const waits = Boolean(e.turnId && e.wait)
    const isAside = Boolean(e.turnId) && !waits
    const isCommand = e.text.trim().startsWith('/')
    const before = await read($, previous)
    // The task a later "yes"/"continue" refers to: kept while off too; not a slash command, and not an aside
    // sent mid-task, so "continue" after an interrupt is judged against the task, not the aside.
    if (!isCommand && !e.turnId) await update($, previous, () => e.text)

    if (isCommand || (await read($, isOff))) {
      // Not judged: its turn runs at the session's effort, not the last task's pick.
      if (waits) await update($, queued, () => ({ text: e.text, judgement: null }))
      else if (!isAside) await update($, judgement, () => null)
      return next(e)
    }

    const current = await read($, judgement)
    // A message typed during a running turn must not unset the running task's pick while Jev answers.
    if (!e.turnId) {
      await update($, judgement, () => ({ phase: 'asking' }))
      $.ui.status('effort: asking Jev...')
    }
    const judged = await judge($, e.text, before, await read($, lastReply)).catch((): Judgement => ({ phase: 'kept', reason: 'Jev unreachable' }))
    // An aside can only raise a running pick. With none running the turn is at the session's effort,
    // which we can't compare against, so the aside leaves it alone.
    let j: Judgement | null = judged
    if (isAside && (current?.phase !== 'picked' || j.phase !== 'picked' || LEVELS.indexOf(j.pick) < LEVELS.indexOf(current.pick))) {
      j = current
    }
    if (waits) await update($, queued, () => ({ text: e.text, judgement: judged }))
    else {
      await update($, judgement, () => j)
      const use = j?.phase === 'picked' ? applied(j.pick, await read($, sessionEffort), canRaise) : undefined
      $.ui.status(j?.phase === 'picked' ? `effort: ${use} (jev ${j.confidence.toFixed(2)})` : undefined)
    }
    await log($, {
      kind: 'decision',
      at: new Date(await $.clock.now()).toISOString(),
      midTurn: isAside,
      queued: waits,
      prompt: e.text.slice(0, 120),
      jev: judged,
      applies: waits ? 'at its own turn' : j?.phase === 'picked' ? applied(j.pick, await read($, sessionEffort), canRaise) : 'session',
    }).catch(() => {})

    return next(e)
  }).catch(async ($, e, next) => {
    // Anything else broke: the prompt goes through untouched; between turns, no stale pick either.
    if (!e.turnId) await update($, judgement, () => null)
    return next(e)
  })

  // A queued prompt's turn begins: its held pick (or none, for a slash command) becomes the running one.
  on('turn.start', async ($, e, next) => {
    // ponytail: one turn record at a time; assumes turn.start is the main thread's (its input has no agentId)
    await update($, run, () => ({ turnId: e.turnId, prompt: e.text, requests: 0, efforts: [], outputTokens: 0 }))
    const q = await read($, queued)
    if (q && e.text.includes(q.text)) {
      await update($, queued, () => null)
      await update($, judgement, () => q.judgement)
      if (!q.text.trim().startsWith('/')) await update($, previous, () => q.text)
    }
    return next(e)
  })

  // Main thread only; subagents keep their own effort. Models without effort (e.effort absent) untouched.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId || e.effort === undefined) return yield* next(e)
    if ((await read($, sessionEffort)) !== e.effort) await update($, sessionEffort, () => e.effort ?? null)
    const j = (await read($, isOff)) ? null : await read($, judgement)
    const pick = j?.phase === 'picked' ? j.pick : undefined

    const result = yield* next(pick ? { ...e, effort: applied(pick, e.effort, canRaise) } : e)
    // Proof, not intent: the effort the bottom of the chain (the engine) actually received.
    const sent = next.trace.at(-1)?.received.effort
    // Written onto the latest pick only if it is still the one this step sent: a mid-turn raise
    // that landed during the step must not be overwritten; the next step proves it instead.
    if (pick) await update($, judgement, cur => (cur?.phase === 'picked' && cur.pick === pick ? { ...cur, from: e.effort, sent } : cur))
    await update($, run, r => (r?.turnId !== e.turnId ? r : {
      ...r,
      session: e.effort,
      requests: r.requests + 1,
      efforts: sent === undefined || r.efforts.includes(sent) ? r.efforts : [...r.efforts, sent],
      outputTokens: r.outputTokens + (result.usage?.output_tokens ?? 0),
    }))
    return result
  })

  // One log line per main-thread turn: what Jev said, and what the requests actually ran at.
  on('turn.complete', async ($, e, next) => {
    // What the agent last proposed or asked: a "yes, fix" approves that, so Jev needs it. Its end carries the ask.
    if (!e.agentId && e.answer) await update($, lastReply, () => e.answer.slice(-1500))
    await active($)
    const r = await read($, run)
    if (!e.agentId && r?.turnId === e.turnId) {
      await update($, run, () => null)
      const { turnId, ...turn } = r
      await log($, {
        kind: 'turn',
        at: new Date(await $.clock.now()).toISOString(),
        ...turn,
        prompt: r.prompt.slice(0, 120),
        jev: (await read($, isOff)) ? 'off' : await read($, judgement),
      }).catch(() => {})
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'auto-effort', description: 'Show what auto-effort did on the last turns' })
    // Open the connection now for the first prompt, then keep it open while the session is in use.
    await active($)
    void warm($)
    return started
  })

  on('command.run', { command: 'auto-effort' }, async $ => ({ text: report(await $.fs.read(await logPath($)).catch(() => '')) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // The band is shared: other mods draw here too, so stack our line on whatever the rest of the chain draws.
    const below = await next(e)
    const j = await read($, judgement)
    const off = await read($, isOff)
    const session = await read($, sessionEffort)

    const { Box, Button, Text } = $.ui.resolve(e)
    const toggle = (
      <Button
        key="toggle"
        label={off ? 'Turn on' : 'Turn off'}
        onPress={async () => {
          await update($, isOff, v => !v)
          await update($, judgement, () => null)
          $.ui.status(undefined)
        }}
      />
    )
    // One line: `<>...</>` is a column Box here, so every group of parts is a row Box.
    const row = (body: JSX.Element) => (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1}><Text bold>» auto-effort </Text>{body}{toggle}</Box>
        {below}
      </Box>
    )
    // The effort a turn runs at when the mod doesn't change it, once a request has shown it.
    const sessionText = session === null ? 'session effort' : `session effort ${String(session).toUpperCase()}`

    if (off) return row(<Text dimColor>{`off · ${sessionText} applies `}</Text>)
    if (!j) return row(<Text dimColor>{`on · ${sessionText} until the next prompt `}</Text>)
    if (j.phase === 'asking') return row(<Text dimColor>◌ asking Jev... </Text>)
    if (j.phase === 'kept') {
      return row(<Box flexDirection="row"><Text color="yellow">{`kept ${sessionText}`}</Text><Text dimColor>{` · ${j.reason} `}</Text></Box>)
    }

    // A 5-cell gauge, filled up to the pick: ▰▰▰▱▱ = high.
    const use = applied(j.pick, session, canRaise)
    const n = LEVELS.indexOf(use) + 1
    const note = (j.from === undefined || j.from === use ? '' : `  (was ${j.from})`) + (use === j.pick ? '' : `  (Jev: ${j.pick}, capped)`)
    return row(
      <Box flexDirection="row">
        <Text color={COLORS[use]}>{'▰'.repeat(n) + '▱'.repeat(LEVELS.length - n)}</Text>
        <Text color={COLORS[use]} bold>{` effort ${use.toUpperCase()}`}</Text>
        {j.sent === undefined
          ? <Text dimColor>{' · not sent yet'}</Text>
          : j.sent === use
            ? <Text color="green">{' ✓ sent'}</Text>
            : <Text color="yellow">{` ⚠ model got ${j.sent}`}</Text>}
        <Text dimColor>{`${note} · Jev ${Math.round(j.confidence * 100)}% sure · ${Math.round(j.ms)}ms `}</Text>
      </Box>,
    )
  })
}
