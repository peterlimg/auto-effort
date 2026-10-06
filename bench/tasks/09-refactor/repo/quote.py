def quote(price: float, qty: int, member: bool = False) -> str:
    total = price * qty
    if qty >= 10:
        total = total * 0.9
    if member:
        total = total * 0.9
    return f"${round(total, 2):.2f}"
