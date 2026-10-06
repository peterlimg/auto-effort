from decimal import Decimal, ROUND_HALF_UP
from report import line_total, report_total
def money(x):
    return Decimal(str(x)).quantize(Decimal("0.01"))
# the spreadsheet: exact decimal maths, each line rounded half-up to the cent
cases = [("1.005", 1, "0"), ("0.125", 1, "0"), ("19.99", 3, "0.075"), ("2.675", 1, "0"), ("10.10", 7, "0.15")]
want = lambda p, q, t: (Decimal(p) * q * (1 + Decimal(t))).quantize(Decimal("0.01"), ROUND_HALF_UP)
for c in cases:
    assert money(line_total(*c)) == want(*c), (c, line_total(*c), want(*c))
assert money(report_total(cases)) == sum(want(*c) for c in cases)
