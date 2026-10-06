# auto-effort

A Claude Code mod that picks `/effort` for each prompt. [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (TypeSafe AI) grades how hard the request is, and the turn's model requests run at that level: `low`, `medium`, `high`, `xhigh` or `max`.

```
» auto-effort ▰▰▰▱▱ effort HIGH ✓ sent  (was medium) · Jev 84% sure · 300ms [Turn off]
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

## How it decides

- Each prompt you write is sent to Jev as one Score question, with your previous prompt as context, so "yes" or "continue" is judged against the task it continues.
- Only the main conversation is changed. Subagents, slash-command turns and models without an effort setting keep your own effort.
- A message sent while a task runs can only raise its effort. A prompt queued with ctrl+x enter is judged for its own turn.
- Messages you didn't write (subagent reports, notifications) aren't judged.

## Develop

```sh
claude --plugin-dir .        # run it from this folder
claude plugin validate .
claude plugin test .
```
