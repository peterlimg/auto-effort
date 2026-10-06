class Account:
    def __init__(self, balance: float = 0.0):
        self.balance = balance

    def withdraw(self, amount: float) -> float:
        self.balance -= amount
        return self.balance
