from billing import calc


def invoice_total(items, tax_rate=0.1):
    return round(calc(items) * (1 + tax_rate), 2)
