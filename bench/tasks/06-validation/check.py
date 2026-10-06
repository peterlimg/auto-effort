from account import Account
a = Account(100)
assert a.withdraw(30) == 70
for bad in (0, -5, 71):
    try:
        a.withdraw(bad)
    except ValueError:
        pass
    else:
        raise AssertionError(f"withdraw({bad}) should raise")
assert a.balance == 70
