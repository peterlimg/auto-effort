import threading
from metrics import Metrics
m = Metrics()
def hammer():
    for _ in range(2000):
        m.record("/a"); m.record("/b")
threads = [threading.Thread(target=hammer) for _ in range(8)]
[t.start() for t in threads]; [t.join() for t in threads]
assert m.snapshot() == {"/a": 16000, "/b": 16000}, m.snapshot()
