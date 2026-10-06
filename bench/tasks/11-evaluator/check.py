import calc, inspect
src = inspect.getsource(calc)
assert "eval(" not in src.replace("evaluate(", "") and "exec(" not in src
cases = {"1+2*3": 7, "(1+2)*3": 9, "-3+5": 2, "2*-(1+1)": -4, "10/4": 2.5, " 7 - 2 - 1 ": 4, "1.5*2": 3, "--2": 2, "2*(3+(4-1))/3": 4}
for e, want in cases.items():
    assert abs(calc.evaluate(e) - want) < 1e-9, (e, calc.evaluate(e))
for bad in ["", "1+", "(1+2", "1+2)", "2**3", "abc"]:
    try:
        calc.evaluate(bad)
    except ValueError:
        continue
    raise AssertionError(f"{bad!r} should raise ValueError")
