def page_count(total: int, per_page: int) -> int:
    return total // per_page


def page(items: list, number: int, per_page: int) -> list:
    """Pages are numbered from 1."""
    if number < 1 or number > page_count(len(items), per_page):
        return []
    start = (number - 1) * per_page
    return items[start:start + per_page]
