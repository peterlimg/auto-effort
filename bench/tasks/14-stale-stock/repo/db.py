import time

_rows = {"apple": 5, "pear": 0}
reads = 0


def read_stock(sku: str) -> int:
    global reads
    reads += 1
    time.sleep(0.001)  # pretend this is slow
    return _rows.get(sku, 0)


def write_stock(sku: str, qty: int) -> None:
    _rows[sku] = qty
