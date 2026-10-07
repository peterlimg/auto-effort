import { expect, mock, test } from 'claude-code/testing'

type Jev = { status: number; ok: boolean; headers: {}; text: string }
const reply = (effort: object): Jev => ({ status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { effort } }) })
const scored = (score: number) => reply({ score, confidence: 0.8 })
const typed = { kind: 'composer' } // a prompt the person typed
const down: Jev = { status: 529, ok: false, headers: {}, text: '{}' }

// The engine beneath the mod: Jev over http.fetch, a session at effort `medium`, and the band mounted.
async function setup($: any, on: any) {
  const clock = mock.clock(on)
  const s = {
    clock,
    jev: scored(2.6),
    hangs: false,
    duringStep: undefined as (() => Promise<unknown>) | undefined, // runs while a model request streams
    bodies: [] as any[],
    heads: 0, // warm-up HEADs that kept the connection to Jev open
    log: '',
    otherSession: undefined as (() => Promise<void>) | undefined,
    sent: [] as unknown[],
    step: async (agentId?: string) => {
      for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'opus', effort: 'medium', messageCount: 1, agentId }));
    },
    shows: async (text: RegExp) => expect(await band.find({ type: 'Text', text })).toBeDefined(),
  }
  on('http.fetch', async (_: any, e: any) => {
    if (e.init?.method === 'HEAD') { s.heads++; return { value: { status: 405, ok: false, headers: {}, text: '' } } }
    s.bodies.push(JSON.parse(e.init.body))
    if (s.hangs) await clock.sleep(60_000)
    return { value: s.jev }
  })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/home/me' })
  on('fs.read', () => ({ value: s.log }))
  on('fs.write', (_: any, e: any) => { s.log = e.text; return { value: undefined } })
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: s.log.length, mtimeMs: 0, isLink: false } }))
  on('process.run', async (_: any, e: any) => { // the log's `cat >> path`; another session may write meanwhile
    await s.otherSession?.()
    s.log += e.init.stdin
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Box', props: { flexDirection: 'row' }, children: [{ type: 'Text', children: ['another mod'] }] })) // what's drawn below us in the band
  on('turn.step', async function* (_: any, e: any) {
    s.sent.push(e.effort)
    const during = s.duringStep
    s.duringStep = undefined
    await during?.()
    const usage = { input_tokens: 0, output_tokens: 21, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'opus' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  const band = await $.ui.mount({
    plugin: 'auto-effort', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
  })
  return Object.assign(s, { band })
}

const canRaise = { options: { raise: true } } // these tests raise above the session's medium

test('Jev picks the main thread effort and the band shows it; failures, subagents and slash commands are left alone', canRaise, async ($, on) => {
  const s = await setup($, on)
  const { sent, bodies, step, shows } = s

  await $.prompt.submit({ origin: typed, text: 'redesign the sync engine' } as any)
  expect(bodies[0]).toMatchObject({ model: 'jev-latest', state: { previous_request: null, last_reply: null, request: 'redesign the sync engine' }, questions: { effort: { type: 'score' } } })
  await step()
  await step('sub-1')
  expect(sent).toEqual(['xhigh', 'medium'])
  await shows(/^▰▰▰▰▱$/)
  await shows(/effort XHIGH/)
  await shows(/✓ sent/)
  await shows(/\(was medium\) · Jev 80% sure/)
  // Our line stays one row (a JSX fragment would be a column Box); the one column stacks it on what's below.
  const band = JSON.stringify(await s.band.find({ type: 'Box', text: /auto-effort/ }))
  expect(band.match(/"flexDirection":"column"/g)?.length).toBe(1)
  await shows(/another mod/) // another mod's band line still shows

  s.jev = down // Jev down: the previous pick must not linger
  await $.prompt.submit({ origin: typed, text: 'hi' } as any)
  await step()
  expect(sent.at(-1)).toBe('medium')
  await shows(/kept session effort MEDIUM/)
  await shows(/Jev HTTP 529/)
  expect(bodies[1].state).toMatchObject({ previous_request: 'redesign the sync engine', request: 'hi' }) // a follow-up is judged with the task before it

  s.jev = scored(0)
  s.hangs = true // Jev hangs: the band says so, then the prompt goes through after the timeout at the session's effort
  const submitted = $.prompt.submit({ origin: typed, text: 'hi again' } as any)
  await s.clock.settle()
  await shows(/asking Jev/)
  await s.clock.advance(3000)
  await submitted
  await step()
  expect(sent.at(-1)).toBe('medium')
  await shows(/Jev timed out/)

  await $.prompt.submit({ origin: typed, text: '/effort high' } as any)
  expect(bodies.length).toBe(3)
  await shows(/on · session effort MEDIUM until the next prompt/) // the toggle stays reachable with no pick

  s.jev = scored(4) // Turned off: Jev isn't asked and the session's effort applies
  s.hangs = false
  await s.band.press({ key: 'toggle' })
  await shows(/off · session effort MEDIUM applies/)
  await $.prompt.submit({ origin: typed, text: 'design a new database' } as any)
  await step()
  expect(bodies.length).toBe(3)
  expect(sent.at(-1)).toBe('medium')

  await s.band.press({ key: 'toggle' }) // back on
  await $.prompt.submit({ origin: typed, text: 'design a new database' } as any)
  await step()
  expect(sent.at(-1)).toBe('max')
})

test('a long task: mid-turn messages only raise a running pick, and nothing stale or malformed applies', canRaise, async ($, on) => {
  const s = await setup($, on)
  const { sent, step, shows } = s
  const aside = (text: string) => $.prompt.submit({ origin: typed, text, turnId: 't' } as any)

  s.jev = scored(1) // a task at medium...
  await $.prompt.submit({ origin: typed, text: 'add a field' } as any)
  s.jev = scored(0) // ...a trivial aside: stays medium
  await aside('also what time is it')
  await step()
  s.jev = down // Jev down mid-turn: stays medium
  await aside('and this')
  await step()
  expect(sent).toEqual(['medium', 'medium'])

  s.jev = scored(4) // a raise landing while a request streams is kept, and proven on the next request
  s.duringStep = () => aside('actually rework the whole sync layer too')
  await step()
  await step()
  expect(sent.slice(2)).toEqual(['medium', 'max'])
  await shows(/effort MAX/)
  await shows(/✓ sent/)

  s.jev = down // no pick running (Jev failed): the turn is at the session's effort...
  await $.prompt.submit({ origin: typed, text: 'tidy the docs' } as any)
  s.jev = scored(0) // ...and a mid-turn "low" must not drop below it
  await aside('quick one')
  await step()
  expect(sent.at(-1)).toBe('medium')

  s.jev = scored(4) // a subagent's report isn't judged: the running pick stays, and it isn't the "previous request"
  await $.prompt.submit({ origin: typed, text: 'add logging' } as any)
  const judgedSoFar = s.bodies.length
  await $.prompt.submit({ origin: { kind: 'peer' }, text: 'Another Claude session sent a message: report' } as any)
  await step()
  expect(s.bodies.length).toBe(judgedSoFar)
  expect(sent.at(-1)).toBe('max')
  await $.prompt.submit({ origin: typed, text: 'yes' } as any)
  expect(s.bodies.at(-1).state.previous_request).toBe('add logging')

  s.jev = scored(3) // a slash command's turn runs at the session's effort, not the last task's pick
  await $.prompt.submit({ origin: typed, text: 'plan the migration' } as any)
  await $.prompt.submit({ origin: typed, text: '/code-review' } as any)
  await step()
  expect(sent.at(-1)).toBe('medium')

  for (const bad of [reply({ score: null, confidence: 0.9 }), reply({ score: 2 })]) {
    s.jev = bad // a null score or a missing confidence is no answer
    await $.prompt.submit({ origin: typed, text: 'fix the bug' } as any)
    await step()
    await shows(/Jev gave no score/)
  }
  expect(sent.slice(-2)).toEqual(['medium', 'medium'])

  s.jev = scored(3) // an aside sent mid-task isn't the "previous request": "continue" after an interrupt refers to the task
  await $.prompt.submit({ origin: typed, text: 'migrate the payments DB' } as any)
  await aside('what is 2+2?')
  await $.prompt.submit({ origin: typed, text: 'continue' } as any)
  expect(s.bodies.at(-1).state.previous_request).toBe('migrate the payments DB')

  s.jev = scored(1) // a task at medium; a prompt queued with ctrl+x enter waits for its own turn...
  await $.prompt.submit({ origin: typed, text: 'add a column' } as any)
  s.jev = scored(4)
  await $.prompt.submit({ origin: typed, text: 'redesign the schema', turnId: 't', wait: true } as any)
  await step()
  expect(sent.at(-1)).toBe('medium') // ...so it neither raises nor lowers the running task
  await $.turn.start({ text: 'redesign the schema', turnId: 't2' } as any)
  await step()
  expect(sent.at(-1)).toBe('max') // and its own turn runs at its own pick
  await $.prompt.submit({ origin: typed, text: 'yes' } as any)
  expect(s.bodies.at(-1).state.previous_request).toBe('redesign the schema')

  // The decision log: one line per judged prompt, mid-turn ones marked, with what Jev said and what applied.
  const entries = s.log.trim().split('\n').map(l => JSON.parse(l))
  expect(entries.find(x => x.prompt === 'also what time is it')).toMatchObject({ midTurn: true, jev: { pick: 'low' }, applies: 'medium' })
  expect(entries.find(x => x.prompt === 'actually rework the whole sync layer too')).toMatchObject({ midTurn: true, applies: 'max' })
  expect(entries.some(x => x.prompt === '/code-review')).toBe(false)
  expect(entries.find(x => x.prompt === 'redesign the schema')).toMatchObject({ midTurn: false, queued: true, applies: 'at its own turn' })
})

test('/auto-effort reports each turn from the mod\'s own log: what Jev picked and what the requests ran at', async ($, on) => {
  const s = await setup($, on)
  const run = async () => ((await $.command.run({ command: 'auto-effort', args: '', origin: typed } as any)) as any).text as string

  expect(await run()).toBe('no turns logged yet.')
  s.jev = scored(0.2)
  await $.prompt.submit({ origin: typed, text: 'what is 2+2' } as any)
  await $.turn.start({ text: 'what is 2+2', turnId: 't' } as any)
  await s.step()
  await s.step()
  await $.turn.complete({ turnId: 't', text: '', reason: 'answer', isAborted: false } as any)

  const text = await run()
  expect(text).toContain('last 1 turns: 1 lowered, 0 raised, 0 unchanged')
  expect(text).toMatch(/^low\s+medium\s+2\s+42\s+low 0\.20 \(80%\)\s+what is 2\+2$/m)
})

test('/auto-effort off stops asking Jev and /auto-effort on resumes', async ($, on) => {
  const s = await setup($, on)
  const run = async (args: string) => ((await $.command.run({ command: 'auto-effort', args, origin: typed } as any)) as any).text as string

  expect(await run('off')).toBe('off: your session effort applies')
  await $.prompt.submit({ origin: typed, text: 'refactor the parser' } as any)
  expect(s.bodies.length).toBe(0)

  expect(await run(' on ')).toBe('on: Jev picks the effort')
  await $.prompt.submit({ origin: typed, text: 'refactor the parser' } as any)
  expect(s.bodies.length).toBe(1)
})

test('sessions logging at once keep each other\'s lines', async ($, on) => {
  const s = await setup($, on)
  s.otherSession = async () => { s.log += '{"kind":"decision","prompt":"from another session"}\n' }
  await $.prompt.submit({ origin: typed, text: 'refactor the parser' } as any)
  const prompts = s.log.trim().split('\n').map(l => JSON.parse(l).prompt)
  expect(prompts).toEqual(['from another session', 'refactor the parser'])
})

test('by default Jev only lowers: a pick above the session effort is capped there, and the band says so', async ($, on) => {
  const s = await setup($, on)
  await s.step() // a request shows the session's effort (medium)

  s.jev = scored(3) // xhigh is capped at medium
  await $.prompt.submit({ origin: typed, text: 'redesign the sync engine' } as any)
  await s.step()
  expect(s.sent.at(-1)).toBe('medium')
  await s.shows(/effort MEDIUM/)
  await s.shows(/✓ sent/)
  await s.shows(/\(Jev: xhigh, capped\)/)

  s.jev = scored(0) // low still applies
  await $.prompt.submit({ origin: typed, text: 'what is 2+2' } as any)
  await s.step()
  expect(s.sent.at(-1)).toBe('low')
})

test('a short approval is judged with the end of the last reply: what it approves', async ($, on) => {
  const s = await setup($, on)
  await $.prompt.submit({ origin: typed, text: 'do next' } as any)
  await $.turn.complete({ turnId: 't', reason: 'answer', isAborted: false, durationMs: 1, answer: 'x'.repeat(5000) + ' Should I add the cap and commit it?' } as any)
  await $.turn.complete({ turnId: 'sub', agentId: 'sub-1', reason: 'answer', isAborted: false, durationMs: 1, answer: 'a subagent report' } as any) // not the main reply
  await $.prompt.submit({ origin: typed, text: 'yes, fix' } as any)
  const state = s.bodies.at(-1).state
  expect(state).toMatchObject({ previous_request: 'do next', request: 'yes, fix' })
  expect(state.last_reply.endsWith('Should I add the cap and commit it?')).toBe(true)
  expect(state.last_reply.length).toBe(1500)
})

test('the connection to Jev is kept warm while the session is in use, and left to close once idle', async ($, on) => {
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'auto-effort' } }))
  const s = await setup($, on)
  await $.session.start({ cwd: '/w' } as any)
  await s.clock.advance(1) // the warm-up runs beside session start, not before it
  expect(s.heads).toBe(1) // the first prompt finds the connection open
  await s.clock.advance(60_000)
  expect(s.heads).toBe(2)
  await s.clock.advance(15 * 60_000) // nobody typed for 15 minutes: no more warm-ups
  const idle = s.heads
  await s.clock.advance(5 * 60_000)
  expect(s.heads).toBe(idle)
  await $.prompt.submit({ origin: typed, text: 'back again' } as any)
  await s.clock.advance(60_000)
  expect(s.heads).toBe(idle + 1)
  expect(s.bodies.length).toBe(1) // the warm-ups never asked Jev anything
})
