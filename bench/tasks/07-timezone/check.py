from datetime import datetime, timezone, timedelta
from reminders import is_past
now = datetime(2030, 1, 1, 0, 30, tzinfo=timezone.utc)
assert is_past("2030-01-01T09:00:00+10:00", now) is True   # 23:00 UTC the day before
assert is_past("2030-01-01T09:00:00-05:00", now) is False  # 14:00 UTC
assert is_past("2030-01-01T00:00:00+00:00", now.astimezone(timezone(timedelta(hours=-8)))) is True
