# Routes still to come

Every route in the Technical Document (ATR-TD-001, section 9), with the
permission it needs. A route moves out of this list and into `atria.yaml`
when its milestone starts: the contract is written first, then the service,
then the clients.

`GET /me` is already in the contract, so it is not repeated here.

A row with several methods or several paths is one line in the source table
and becomes one operation per method and path when it is specified properly.

## Identity and accounts

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| POST | `/me/profile` | patient.update (own) | Complete your profile: confirm names and date of birth, set language |
| POST | `/me/phone/code and /me/phone/verify` | patient.update (own) | Send and check the one-time code that sets phoneVerifiedAt |
| POST | `/me/guardian` | patient.update (own) | Link a guardian for a patient under 18 and record consent method |
| GET and PUT | `/me/preferences` | patient.update (own) | Channels, lead times, proxy recipient, auto-accept for same-day offers |
| GET and POST | `/me/consents and /me/export and /me/erasure` | patient.read (own) | Data subject rights |

`POST /admin/staff`, `PATCH /admin/staff/{id}/roles` and `POST /admin/staff/{id}/suspend`
are in the contract and built (2026-09-22), so they are not repeated here. `GET /admin/staff`
(2026-09-25) was not in the Technical Document's table; it is the list an administrator
changes roles and suspends from, and is what FR-ACC-18 needs in practice.

## Directory and capacity

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET and PUT | `/clinicians/{id}/availability` | availability.read and availability.write | Weekly template on the grid unit |
| POST | `/clinicians/{id}/unavailability` | session.disrupt | Mark a clinician unavailable for a window; starts disruption |
| POST | `/sessions/{id}/disrupt` | session.disrupt | Shift every ticket's arrival window and notify |

`GET /clinicians`, `GET /clinicians/{id}/slots`, `GET /clinicians/{id}/calendar`
and `GET /clinics/{id}/day` are in the contract and built (2026-09-23), so they
are not repeated here. The last two were not in the Technical Document's route
table; they are what FR-STF-01 needs from the two indexes built for it.

`GET /clinics` and `GET /appointment-types` (2026-09-24) were not in that table
either. A patient cannot book on their own without them: the free starts need a
type, and a listing needs the clinic's name. Both are read only; creating and
changing clinics and types stays with the administration routes below.

## Booking and the day

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/tickets/{id}` | appointment.read | Live position and arrival window |
| POST | `/appointments/{id}/confirm` | appointment.read (own) | Patient confirms a placed procedure or a disruption offer |
| PATCH | `/appointments/{id}` | appointment.reschedule | Reschedule; staff must give a reason |
| POST | `/appointments/{id}/arrival and /no-show` | appointment.check_in and appointment.mark_no_show | Record attendance outcomes |
| GET and PUT | `/appointments/{id}/care-context` | care_context.read and care_context.write | Care context for the patient and the assigned clinician only |
| POST | `/appointments/{id}/referral` | appointment.create | Referring facility and clinician, with a presigned upload for the note |

`POST /appointments`, `GET /appointments/{id}`, `DELETE /appointments/{id}`
and `GET /patients/me/appointments` are in the contract and built (2026-09-22
and 2026-09-23), so they are not repeated here. The range views on the list are
still to come: it answers upcoming, past or all for now.

## People, quality and money

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| PATCH | `/patients/{id}` | patient.update | Change a patient's record; strike count when strikes are on |
| POST | `/appointments/{id}/feedback` | feedback.submit | Structured answers, free text and a safety or conduct flag; attended visits only |
| GET | `/feedback?clinicId=&clinicianId=&from=` | feedback.read | Scoped: own aggregate, clinic aggregate and flagged reviews, or tenant-wide |
| GET | `/fee-ledger?clinicId=&from=` | fee_ledger.read | Fee band, XAF amount, outcome and entitlement per appointment |

## Institution and oversight

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET and POST and PATCH | `/admin/clinics and /admin/appointment-types and /admin/intake-forms` | clinic.manage and appointment_type.manage | Institution configuration |
| GET and POST and PATCH | `/admin/fee-bands` | fee_band.manage | Per-practice baselines from the ministerial schedule |
| PUT | `/admin/region-pack` | region_pack.choose | Choose the region pack; refused once the first appointment exists |
| PUT | `/admin/feature-flags` | feature_flag.set | Quality programme, strikes; ratingAffectsFee refused where the pack forbids it |
| GET | `/audit?actor=&action=&from=&to=` | audit.read | Read-only audit trail |

## Built in Phase 2, waves 6 to 9 (2026-09-27)

These moved into the contract, some under paths that differ from the table
above, which is kept as the Technical Document wrote it:

- The register: `GET /patients`, `POST /patients`, `GET /patients/{id}`; the
  roster `GET /clinics/{id}/roster`; `PUT /admin/staff/{id}/priority-allowance`;
  the week's changes `GET /audit/changes`.
- Sessions per unit, `GET` and `POST /clinics/{id}/sessions`, then
  `GET /sessions/{id}`, `POST /sessions/{id}/tickets`, `GET /sessions/{id}/queue`,
  `POST /sessions/{id}/next` and `POST /sessions/{id}/close`.
- Procedure requests: `POST /procedure-requests`, the inbox
  `GET /clinics/{id}/requests`, and `POST /appointments/{id}/place` and
  `/decline` in place of `/procedure-requests/{id}/placement`.
- The weekly report `GET /clinics/{id}/report` and `GET /reports`; the fee
  ledger's entry is on `GET /appointments/{id}` rather than its own route.
- The message log `GET /clinics/{id}/messages` (message.read, which the
  specification now carries) and the delivery figures `GET /messages/delivery`.
  Resending a failed message is still to come; the desk phones instead.
