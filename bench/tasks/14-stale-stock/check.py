import catalog, checkout, db, warehouse
assert catalog.stock("pear") == 0
warehouse.restock("pear", 3)
assert catalog.stock("pear") == 3, "stale after restock"
checkout.sell("pear", 2)
assert catalog.stock("pear") == 1, "stale after sale"
try:
    checkout.sell("pear", 2)
    raise AssertionError("oversold")
except ValueError:
    pass
db.reads = 0
for _ in range(100):
    catalog.stock("apple")
assert db.reads <= 1, f"cache no longer caches ({db.reads} reads)"
