from lru import LRUCache
c = LRUCache(2)
c.put("a", 1); c.put("b", 2)
assert c.get("a") == 1
c.put("c", 3)                      # evicts b (a was used)
assert c.get("b") is None and c.get("c") == 3
c.put("a", 10)                     # update refreshes a
c.put("d", 4)                      # evicts c
assert c.get("c") is None and c.get("a") == 10 and c.get("d") == 4
big = LRUCache(1000)
for i in range(5000):
    big.put(i, i)
assert big.get(4999) == 4999 and big.get(4000) == 4000 and big.get(3999) is None
