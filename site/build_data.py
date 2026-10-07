#!/usr/bin/env python3
"""Writes site/data.js from the benchmark results and the local Jev decision log.

  site/build_data.py   # then open site/index.html

Every number on the page comes from here: the three A/B runs in bench/results/ and
~/.claude/auto-effort/decisions.jsonl, plus prompt-cache reads from ~/.claude/projects transcripts. Chat prompts are an allow-list, so nothing private leaks.
"""
import json
from datetime import datetime
from pathlib import Path

SITE = Path(__file__).resolve().parent
BENCH = SITE.parent / 'bench'
LOG = Path.home() / '.claude/auto-effort/decisions.jsonl'
RUNS = {'high': '20261007-024329', 'medium': '20261007-030459', 'harder': '20261007-031741'}
CHAT = ['Reply with just OK.', 'yes', 'yes, fix', 'how to do option 1 when claude run in other project dir',
        'okay, now how to load the mod globally', 'make the html interactive', 'yes, make it', 'go']
KEEP = ('task', 'arm', 'run', 'pass', 'cost', 'output_tokens', 'thinking_tokens', 'turns', 'seconds', 'efforts')


def cache_stats():
    """Prompt-cache reads on main-thread requests within 5 minutes of the previous one, split by
    whether the effort changed between them. A request 'hits' when over 95% of its input came from cache."""
    out = {'changed': [0, 0], 'same': [0, 0]}  # [hits, requests]
    for path in (Path.home() / '.claude/projects').glob('*/*.jsonl'):
        prev, seen = None, set()
        for line in path.open():
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get('message') or {}
            if d.get('type') != 'assistant' or 'effort' not in d or d.get('isSidechain') or m.get('id') in seen:
                continue
            seen.add(m.get('id'))
            u = m.get('usage') or {}
            total = u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
            at = datetime.fromisoformat(d['timestamp'].replace('Z', '+00:00'))
            if prev and total > 5000 and (at - prev[1]).total_seconds() < 300:
                bucket = out['changed' if d['effort'] != prev[0] else 'same']
                bucket[0] += u.get('cache_read_input_tokens', 0) / total > 0.95
                bucket[1] += 1
            prev = (d['effort'], at)
    return out


def main():
    runs = {}
    for name, stamp in RUNS.items():
        rows = [json.loads(l) for l in (BENCH / 'results' / stamp / 'runs.jsonl').read_text().splitlines() if l.strip()]
        runs[name] = [{k: r[k] for k in KEEP} for r in rows]

    prompts = {t.name: (t / 'prompt.txt').read_text().strip() for t in sorted((BENCH / 'tasks').iterdir()) if t.is_dir()}
    by_prompt = {v: k for k, v in prompts.items()}
    decisions = [d for d in map(json.loads, LOG.read_text().splitlines()) if 'jev' in d and d.get('kind') != 'turn']

    def sample(d):
        j = d['jev']
        return {'pick': j['pick'], 'score': j['score'], 'confidence': j['confidence'], 'ms': j['ms']}

    jev_tasks, chat = {}, []
    for d in decisions:
        if d['jev']['phase'] != 'picked':
            continue
        task = by_prompt.get(d['prompt'])
        if task and task not in jev_tasks:
            jev_tasks[task] = sample(d)
        if d['prompt'] in CHAT and d.get('applies'):
            chat.append({'prompt': d['prompt'], 'at': d['at'], 'midTurn': d.get('midTurn', False),
                         'applies': d.get('applies'), **sample(d)})

    cache = cache_stats()
    # The warm-up's end-to-end checks: tagged prompts sent from fresh sessions with the old and new mod.
    warm = [{'prompt': d['prompt'], 'ms': d['jev']['ms']} for d in decisions
            if 'ms' in d['jev'] and any(t in d['prompt'] for t in ('(warm-test old', '(warm-test new', '(warm-start', '(fresh-session'))]
    latency = sorted(d['jev']['ms'] for d in decisions if 'ms' in d['jev'])
    data = {
        'runs': runs, 'prompts': prompts, 'cache': cache, 'warm': warm, 'jevTasks': jev_tasks, 'chat': chat, 'latency': latency,
        'decisions': len(decisions), 'timeouts': sum(d['jev'].get('reason', '').startswith('Jev timed out') for d in decisions),
    }
    (SITE / 'data.js').write_text('window.DATA = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    print(f"data.js: {sum(map(len, runs.values()))} runs, {len(jev_tasks)} task picks, {len(chat)} chat picks, {len(latency)} latencies")


if __name__ == '__main__':
    main()
