def line_total(unit_price: str, qty: int, tax_rate: str) -> float:
    """Prices and rates arrive as strings from the CSV export, e.g. "19.99" and "0.075"."""
    return round(float(unit_price) * qty * (1 + float(tax_rate)), 2)


def report_total(lines) -> float:
    return round(sum(line_total(*line) for line in lines), 2)
