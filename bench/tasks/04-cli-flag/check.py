import subprocess, sys
run = lambda *a: subprocess.run([sys.executable, "cli.py", *a], capture_output=True, text=True, check=True).stdout.strip()
assert run("hi", "--times", "2") == "hi hi"
assert run("hi", "--times", "2", "--upper") == "HI HI"
