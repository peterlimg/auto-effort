#!/usr/bin/env python3
"""A/B benchmark: the same tasks with auto-effort on and off.

Each run copies a task's fixture repo to a fresh temp dir, runs headless Claude Code on the task's prompt,
then grades the result with the task's hidden check.py. Both arms use the same model, session effort,
prompt and settings; the only difference is `--plugin-dir <this repo>` on the "on" arm.

  bench/run.py                       # 12 tasks x 2 arms x 3 runs at --effort high
  bench/run.py --tasks 02,10 --runs 1
  bench/run.py --report bench/results/<stamp>

Per run it records Claude Code's own numbers from `--output-format json` (total_cost_usd, output and
thinking tokens, turns, duration), the effort each model request ran at (from the session transcript),
and pass/fail. Results go to bench/results/<stamp>/runs.jsonl; the report is printed at the end.
"""
import argparse
import json
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BENCH = Path(__file__).resolve().parent
MOD = BENCH.parent
TASKS = BENCH / 'tasks'
PROJECTS = Path.home() / '.claude/projects'
ALLOWED = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(python3:*)', 'Bash(python:*)', 'Bash(ls:*)', 'Bash(cat:*)']


def efforts_of(session_id: str) -> list:
    """The efforts the session's model requests ran at, in first-seen order."""
    for path in PROJECTS.glob(f'*/{session_id}.jsonl'):
        seen, efforts = set(), []
        for line in path.open():
            d = json.loads(line)
            m = d.get('message') or {}
            if d.get('type') == 'assistant' and 'effort' in d and m.get('id') not in seen:
                seen.add(m.get('id'))
                efforts.append(d['effort'])
        return efforts
    return []


def run_one(task: Path, arm: str, n: int, args) -> dict:
    work = Path(tempfile.mkdtemp(prefix=f'ae-{task.name}-{arm}-'))
    try:
        shutil.copytree(task / 'repo', work, dirs_exist_ok=True)
        git = ['git', '-c', 'user.name=bench', '-c', 'user.email=bench@example.com']
        subprocess.run(['git', 'init', '-q'], cwd=work, check=True)
        subprocess.run([*git, 'add', '-A'], cwd=work, check=True)
        subprocess.run([*git, 'commit', '-qm', 'fixture'], cwd=work, check=True)

        cmd = ['claude', '-p', (task / 'prompt.txt').read_text().strip(), '--output-format', 'json',
               '--effort', args.effort, '--permission-mode', 'acceptEdits', '--allowedTools', *ALLOWED,
               '--strict-mcp-config', '--max-budget-usd', str(args.run_cap)]
        if args.model:
            cmd += ['--model', args.model]
        if arm == 'on':
            cmd += ['--plugin-dir', str(MOD)]
        started = time.time()
        proc = subprocess.run(cmd, cwd=work, capture_output=True, text=True, timeout=args.timeout)
        out = json.loads(proc.stdout)

        answer = work.parent / f'{work.name}.answer.txt'
        answer.write_text(out.get('result') or '')
        check = subprocess.run([sys.executable, str(task / 'check.py'), str(answer)], cwd=work,
                               env={'PYTHONPATH': str(work), 'PATH': '/usr/bin:/bin'}, capture_output=True, text=True, timeout=120)
        answer.unlink()

        usage = list((out.get('modelUsage') or {}).values())
        return {
            'task': task.name, 'arm': arm, 'run': n,
            'pass': check.returncode == 0,
            'fail': (check.stderr.strip().splitlines() or [''])[-1][:200],
            'cost': out.get('total_cost_usd') or 0.0,
            'output_tokens': sum(u.get('outputTokens', 0) for u in usage),
            'thinking_tokens': sum(u.get('thinkingTokens', 0) for u in usage),
            'turns': out.get('num_turns'),
            'seconds': round(time.time() - started, 1),
            'efforts': sorted(set(efforts_of(out['session_id'])), key=efforts_of(out['session_id']).index),
            'is_error': out.get('is_error'),
            'session_id': out.get('session_id'),
        }
    except Exception as err:  # a run that crashed or timed out counts as a failure, with the reason kept
        return {'task': task.name, 'arm': arm, 'run': n, 'pass': False, 'fail': f'harness: {err!r}'[:200],
                'cost': 0.0, 'output_tokens': 0, 'thinking_tokens': 0, 'turns': None, 'seconds': None,
                'efforts': [], 'is_error': True}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else 0.0


def report(results_dir: Path) -> str:
    runs = [json.loads(l) for l in (results_dir / 'runs.jsonl').read_text().splitlines() if l.strip()]
    tasks = sorted({r['task'] for r in runs})
    by = lambda t, a: [r for r in runs if r['task'] == t and r['arm'] == a]
    lines = [
        '| task | arm | pass | ran at | cost $ | output tok | thinking tok | turns | seconds |',
        '|---|---|---|---|---|---|---|---|---|',
    ]
    for t in tasks:
        for a in ('off', 'on'):
            rs = by(t, a)
            if not rs:
                continue
            ran = sorted({e for r in rs for e in r['efforts']}, key=['low', 'medium', 'high', 'xhigh', 'max'].index)
            lines.append(f"| {t} | {a} | {sum(r['pass'] for r in rs)}/{len(rs)} | {'/'.join(ran) or '-'} "
                         f"| {mean([r['cost'] for r in rs]):.3f} | {mean([r['output_tokens'] for r in rs]):.0f} "
                         f"| {mean([r['thinking_tokens'] for r in rs]):.0f} | {mean([r['turns'] for r in rs]):.1f} "
                         f"| {mean([r['seconds'] for r in rs]):.0f} |")

    def total(a, key):
        return sum(r[key] for r in runs if r['arm'] == a)

    def delta(key, money=False):
        off, on = total('off', key), total('on', key)
        fmt = (lambda x: f'{x:,.2f}') if money else (lambda x: f'{x:,.0f}')
        return f'{fmt(off)} → {fmt(on)} ({(on - off) / off:+.0%})' if off else f'{fmt(off)} → {fmt(on)}'

    n = {a: sum(1 for r in runs if r['arm'] == a) for a in ('off', 'on')}
    passed = {a: sum(r['pass'] for r in runs if r['arm'] == a) for a in ('off', 'on')}
    lines += [
        '',
        f"**Totals, off → on** ({n['off']} vs {n['on']} runs)",
        f"- pass: {passed['off']}/{n['off']} → {passed['on']}/{n['on']}",
        f"- cost $: {delta('cost', money=True)}",
        f"- output tokens: {delta('output_tokens')}",
        f"- thinking tokens: {delta('thinking_tokens')}",
        f"- seconds: {delta('seconds')}",
    ]
    errors = [r for r in runs if r['is_error'] or r['fail'].startswith('harness')]
    if errors:
        lines.append(f"- runs with errors: {len(errors)} ({', '.join(sorted({r['task'] + '/' + r['arm'] for r in errors}))})")
    return '\n'.join(lines)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--tasks', help='comma-separated task prefixes, e.g. 02,10 (default: all)')
    p.add_argument('--runs', type=int, default=3, help='runs per task per arm')
    p.add_argument('--effort', default='high', help="the session effort both arms start from (the 'off' arm keeps it)")
    p.add_argument('--model', help='model for both arms (default: your Claude Code default)')
    p.add_argument('--jobs', type=int, default=4, help='runs in parallel')
    p.add_argument('--max-cost', type=float, default=60.0, help='stop starting new runs past this total, in USD')
    p.add_argument('--run-cap', type=float, default=3.0, help='--max-budget-usd for each run')
    p.add_argument('--timeout', type=int, default=900, help='seconds per run')
    p.add_argument('--seed', type=int, default=1)
    p.add_argument('--report', type=Path, help='print the report for an existing results dir and exit')
    args = p.parse_args()

    if args.report:
        print(report(args.report))
        return

    wanted = args.tasks.split(',') if args.tasks else None
    tasks = [t for t in sorted(TASKS.iterdir()) if t.is_dir() and (not wanted or any(t.name.startswith(w) for w in wanted))]
    plan = [(t, arm, n) for t in tasks for n in range(1, args.runs + 1) for arm in ('off', 'on')]
    random.Random(args.seed).shuffle(plan)  # interleave arms and tasks so time-of-day drift hits both alike

    out_dir = BENCH / 'results' / time.strftime('%Y%m%d-%H%M%S')
    out_dir.mkdir(parents=True)
    (out_dir / 'config.json').write_text(json.dumps({**vars(args), 'report': None, 'tasks': [t.name for t in tasks]}, indent=2))
    lock, spent, done = threading.Lock(), [0.0], [0]

    def job(item):
        task, arm, n = item
        with lock:
            if spent[0] >= args.max_cost:
                return
        r = run_one(task, arm, n, args)
        with lock:
            spent[0] += r['cost']
            done[0] += 1
            with (out_dir / 'runs.jsonl').open('a') as f:
                f.write(json.dumps(r) + '\n')
            print(f"[{done[0]}/{len(plan)}] {r['task']:15} {arm:3} #{n} {'PASS' if r['pass'] else 'FAIL'} "
                  f"${r['cost']:.3f} {'/'.join(map(str, r['efforts'])) or '-':12} total ${spent[0]:.2f}", flush=True)

    print(f'{len(plan)} runs ({len(tasks)} tasks x 2 arms x {args.runs}) at --effort {args.effort} -> {out_dir}', flush=True)
    with ThreadPoolExecutor(args.jobs) as pool:
        list(pool.map(job, plan))
    print('\n' + report(out_dir))


if __name__ == '__main__':
    main()
