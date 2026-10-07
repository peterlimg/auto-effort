from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from calendar_slots import free_slots
mel, utc, ny = ZoneInfo("Australia/Melbourne"), ZoneInfo("UTC"), ZoneInfo("America/New_York")
M = lambda h, m=0, d=date(2030, 3, 5): datetime(d.year, d.month, d.day, h, m, tzinfo=mel)
# meetings in other zones, overlapping each other and spilling past 17:00
busy = [(M(10).astimezone(utc), M(11).astimezone(utc)),
        (M(10, 30).astimezone(ny), M(12).astimezone(ny)),
        (M(16, 30), M(18))]
got = free_slots(date(2030, 3, 5), "Australia/Melbourne", busy, timedelta(minutes=30))
assert got == [(M(9), M(10)), (M(12), M(16, 30))], got
assert all(s.utcoffset() == M(9).utcoffset() for s, _ in got)
# gaps shorter than the minimum are dropped; a meeting before work hours is ignored
busy2 = [(M(8), M(9, 20)), (M(9, 40), M(17))]
assert free_slots(date(2030, 3, 5), "Australia/Melbourne", busy2, timedelta(minutes=30)) == []
# DST: Melbourne goes back an hour on 2030-04-07; working hours are still 09:00-17:00 local
d = date(2030, 4, 7)
got = free_slots(d, "Australia/Melbourne", [], timedelta(hours=1))
assert got == [(M(9, d=d), M(17, d=d))] and got[0][0].utcoffset() == timedelta(hours=10), got
