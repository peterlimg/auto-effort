from datetime import date, datetime, timedelta


def free_slots(day: date, user_tz: str, busy: list[tuple[datetime, datetime]], minimum: timedelta) -> list[tuple[datetime, datetime]]:
    """`busy` holds aware datetimes, each pair in whatever timezone the meeting was booked in.
    `user_tz` is an IANA name such as "Australia/Melbourne"."""
    raise NotImplementedError
