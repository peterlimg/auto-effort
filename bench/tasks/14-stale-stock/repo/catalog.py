from functools import lru_cache

import db


@lru_cache(maxsize=1024)
def stock(sku: str) -> int:
    return db.read_stock(sku)
