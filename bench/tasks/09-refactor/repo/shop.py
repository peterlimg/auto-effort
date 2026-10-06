def price_after_discount(price: float, qty: int, member: bool) -> float:
    total = price * qty
    if qty >= 10:
        total *= 0.9
    if member:
        total *= 0.95
    return round(total, 2)
