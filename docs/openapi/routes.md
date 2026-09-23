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
| PUT | `/admin/staff/{id}/priority-allowance` | priority_allowance.grant | Grant or change a monthly priority quota |

`POST /admin/staff`, `PATCH /admin/staff/{id}/roles` and `POST /admin/staff/{id}/suspend`
are in the contract and built (2026-09-22), so they are not repeated here.

## Directory and capacity

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET and PUT | `/clinicians/{id}/availability` | availability.read and availability.write | Weekly template on the grid unit |
| POST | `/clinicians/{id}/unavailability` | session.disrupt | Mark a clinician unavailable for a window; starts disruption |
| GET and POST | `/sessions` | availability.read and session.publish | List or publish sessions with window and rostered GPs; capacity is derived |
| POST | `/sessions/{id}/disrupt` | session.disrupt | Shift every ticket's arrival window and notify |

`GET /clinicians`, `GET /clinicians/{id}/slots`, `GET /clinicians/{id}/calendar`
and `GET /clinics/{id}/day` are in the contract and built (2026-09-23), so they
are not repeated here. The last two were not in the Technical Document's route
table; they are what FR-STF-01 needs from the two indexes built for it.

## Booking and the day

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| POST | `/sessions/{id}/tickets` | appointment.create | General line: issue a queue ticket; position assigned by the server |
| GET | `/tickets/{id}` | appointment.read | Live position and arrival window |
| POST | `/procedure-requests` | procedure.request | Raise a REQUESTED appointment with no time held |
| POST | `/procedure-requests/{id}/placement` | procedure.size_and_place | Size and place a request for the patient to confirm |
| POST | `/appointments/{id}/confirm` | appointment.read (own) | Patient confirms a placed procedure or a disruption offer |
| PATCH | `/appointments/{id}` | appointment.reschedule | Reschedule; staff must give a reason |
| POST | `/appointments/{id}/arrival and /no-show` | appointment.check_in and appointment.mark_no_show | Record attendance outcomes |
| POST | `/sessions/{id}/next` | queue.assign_next | Assign the next ticket to the calling clinician |
| GET and PUT | `/appointments/{id}/care-context` | care_context.read and care_context.write | Care context for the patient and the assigned clinician only |
| POST | `/appointments/{id}/referral` | appointment.create | Referring facility and clinician, with a presigned upload for the note |

`POST /appointments`, `GET /appointments/{id}`, `DELETE /appointments/{id}`
and `GET /patients/me/appointments` are in the contract and built (2026-09-22
and 2026-09-23), so they are not repeated here. The range views on the list are
still to come: it answers upcoming, past or all for now.

## People, quality and money

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET and POST | `/patients` | patient.read and patient.create | Search the register; quick-create a patient at the desk |
| GET and PATCH | `/patients/{id}` | patient.read and patient.update | Patient record within scope; strike count when strikes are on |
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
| GET | `/reports/attendance?by=channel and /reports/reschedules/weekly` | report.read | Attendance and no-show by channel; weekly reschedules grouped by actor |
| GET and POST | `/messages?status=` | message.send | Message log with failures first; resend |
