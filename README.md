# auto-effort

A Claude Code mod that picks `/effort` for each prompt. [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (TypeSafe AI) grades how hard the request is, and the turn's model requests run at that level: `low`, `medium`, `high`, `xhigh` or `max`. By default it only lowers effort below your own setting; raising is opt-in (see Settings).

```
» auto-effort ▰▰▱▱▱ effort MEDIUM ✓ sent  (was high) · Jev 84% sure · 300ms [Turn off]
```

## Install

```
/plugin install auto-effort --marketplace peterlimg/auto-effort
```

Answer `y` to add the marketplace, then pick a scope. It needs a TypeSafe API key in the environment Claude Code starts with:

```sh
export TYPESAFE_API_KEY=...        # fish: set -Ux TYPESAFE_API_KEY ...
```

Without a key, or when Jev fails or takes over 3s, your own `/effort` applies.

## Use

- **The band above the prompt** shows the level in use, whether the request was actually sent at it (`✓ sent`), Jev's confidence, and a **Turn off / Turn on** button.
- **`/auto-effort`** prints the last turns: what Jev picked, what each turn's requests ran at, and how many turns were lowered or raised from your session's effort.
- **`~/.claude/auto-effort/decisions.jsonl`** keeps one JSON line per judged prompt and per turn.

## Settings

- **`raise`** (default off): let Jev raise effort above your session setting for hard tasks. Off, a higher pick is capped at your setting and the band shows `(Jev: xhigh, capped)`. Set it in `/config`, or in settings under `pluginConfigs.auto-effort.raise`.

In the benchmark below, lowering from `high` cut thinking tokens 27% with no change in pass rate, while raising from `medium` cost 4-15% more and changed no outcomes. So it's off by default.

## How it decides

- Each prompt you write is sent to Jev as one Score question, with your previous prompt and the end of the last reply as context, so "yes, fix" is judged against what it approves.
- Only the main conversation is changed. Subagents, slash-command turns and models without an effort setting keep your own effort.
- A message sent while a task runs can only raise its effort (up to your setting, unless `raise` is on). A prompt queued with ctrl+x enter is judged for its own turn.
- Messages you didn't write (subagent reports, notifications) aren't judged.

## Benchmark

`bench/run.py` runs the same tasks with the mod on and off and compares cost, tokens and pass rate. Each run copies a task's fixture repo to a temp dir, runs `claude -p` on its prompt, and grades the result with a hidden `check.py`. Both arms share the model, session effort, prompt and settings; only `--plugin-dir` differs.

```sh
bench/run.py                          # 12 tasks x 2 arms x 3 runs at --effort high
bench/run.py --tasks 02,10 --runs 1   # a quick smoke run
bench/run.py --effort medium          # let the mod raise as well as lower
```

Costs come from Claude Code's own `total_cost_usd`; the effort each request ran at comes from the session transcript. `--max-cost` (default $60) stops new runs once the total is spent.

## Develop

```sh
claude --plugin-dir .        # run it from this folder
claude plugin validate .
claude plugin test .
```
