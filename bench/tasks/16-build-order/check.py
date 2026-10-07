from build import CycleError, build_order
assert build_order({"app": ["lib", "utils"], "lib": ["utils"], "tests": ["app"]}) == ["utils", "lib", "app", "tests"]
assert build_order({"b": [], "a": [], "c": ["a"]}) == ["a", "b", "c"]
assert build_order({"z": ["y", "x"]}) == ["x", "y", "z"]
for deps in [{"a": ["b"], "b": ["a"]}, {"a": ["b"], "b": ["c"], "c": ["a"], "d": ["a"]}, {"x": ["x"]}]:
    try:
        build_order(deps)
    except CycleError as e:
        c = e.cycle
        assert c[0] == c[-1] and len(c) >= 2, c
        assert all(c[i + 1] in deps.get(c[i], []) for i in range(len(c) - 1)), c
        continue
    raise AssertionError(f"{deps} should raise CycleError")
