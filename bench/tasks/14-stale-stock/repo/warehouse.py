import db
from catalog import stock


def restock(sku: str, qty: int) -> int:
    new = stock(sku) + qty
    db.write_stock(sku, new)
    return new
