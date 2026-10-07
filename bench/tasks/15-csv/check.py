import inspect, csvlite
from csvlite import parse_csv
assert "import csv" not in inspect.getsource(csvlite)
cases = {
    "a,b\n1,2\n": [["a", "b"], ["1", "2"]],
    "a,b\r\n1,2": [["a", "b"], ["1", "2"]],
    '"x,y",z\n': [["x,y", "z"]],
    '"he said ""hi""",2\n': [['he said "hi"', "2"]],
    '"line1\nline2",3\n': [["line1\nline2", "3"]],
    'a,,c\n,\n': [["a", "", "c"], ["", ""]],
    '"",x\n': [["", "x"]],
    "": [],
}
for text, want in cases.items():
    assert parse_csv(text) == want, (text, parse_csv(text))
for bad in ['"abc', '"a"b,c', 'x,"y\n']:
    try:
        parse_csv(bad)
    except ValueError:
        continue
    raise AssertionError(f"{bad!r} should raise ValueError")
