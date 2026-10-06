from pagination import page, page_count
assert page_count(10, 5) == 2 and page_count(11, 5) == 3 and page_count(0, 5) == 0
assert page(list(range(11)), 3, 5) == [10]
assert page(list(range(10)), 3, 5) == []
