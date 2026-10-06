from datetime import datetime


def parse_meeting(iso: str) -> datetime:
    """Meetings are stored as ISO 8601 strings with a UTC offset, e.g. 2030-01-01T09:00:00+10:00."""
    return datetime.fromisoformat(iso).replace(tzinfo=None)


def is_past(iso: str, now: datetime) -> bool:
    """`now` is timezone-aware."""
    return parse_meeting(iso) < now.replace(tzinfo=None)
