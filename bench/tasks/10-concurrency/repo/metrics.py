import time


class Metrics:
    def __init__(self):
        self.counts = {}

    def record(self, route: str) -> None:
        current = self.counts.get(route, 0)
        time.sleep(0)  # yield, as real work between read and write would
        self.counts[route] = current + 1

    def snapshot(self) -> dict:
        return dict(self.counts)
