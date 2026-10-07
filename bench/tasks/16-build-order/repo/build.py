class CycleError(Exception):
    def __init__(self, cycle: list[str]):
        super().__init__(" -> ".join(cycle))
        self.cycle = cycle


def build_order(deps: dict[str, list[str]]) -> list[str]:
    raise NotImplementedError
