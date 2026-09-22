# 0004. Grid unit plus typed duration

Status: accepted
Source: AD-04 in the Technical Document (ATR-TD-001, section 3)

## Decision

The tenant sets a calendar grid unit (default 10 minutes) and every appointment type carries its
own duration and buffer in grid units. A booking locks N consecutive units in one transaction.

## Consequences

Established by specialist booking, 2026-09-22.

One lock item per grid unit, each in its own partition (`TENANT#t#LOCK#clinicianId#unitStart`),
written with the appointment and its first event in a single `transact_write_items`. Every put is
conditional on the item not existing, so a taken unit cancels the whole transaction: two patients
asking for one minute produce one booking and one 409, and a refused attempt leaves neither a
partial lock nor an orphaned appointment.

Consequences that followed, and are worth knowing before changing any of this:

- A booking holds `durationUnits + bufferUnits`, but `endAt` is derived from `durationUnits`
  alone. The buffer blocks the next booking without appearing in what the patient is told, so the
  two are separate values on `core.booking.Occupancy` rather than one.
- A start must fall on a unit boundary. Half occupying two units would leave a gap no later
  booking can use, so an off-grid start is refused rather than rounded.
- The tenant's `gridUnitMinutes` must divide an hour, or unit boundaries drift across the day and
  locks stop lining up.
- A transaction carries at most 100 items, which caps an appointment at 98 units. Longer types are
  refused at validation rather than failing at the write.
- Locks carry a TTL set past the last unit they hold. A lock is meaningless once its minute has
  passed, and without the TTL the table would keep a row per booked minute forever.
- The clinic is not accepted from the request. It comes from the chosen clinician's membership,
  because the clinic decides which staff scope reaches the record.

Reschedule will need the same transaction to release units as well as take them, which is a
mixed delete and put rather than the conditional puts used here.
