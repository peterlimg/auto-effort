import db
from catalog import stock


def sell(sku: str, qty: int) -> int:
    have = stock(sku)
    if qty > have:
        raise ValueError(f"only {have} {sku} left")
    db.write_stock(sku, have - qty)
    return have - qty
