import cart, quote, shop
for price, qty, member in [(5.0, 10, False), (5.0, 10, True), (3.0, 2, True), (1.0, 11, False)]:
    want = shop.price_after_discount(price, qty, member)
    assert cart.cart_line_total(price, qty, member) == want, ("cart", price, qty, member)
    assert quote.quote(price, qty, member) == f"${want:.2f}", ("quote", price, qty, member)
assert shop.price_after_discount(5.0, 10, True) == 42.75
