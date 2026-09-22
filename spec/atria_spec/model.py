"""Atria Rev B data model.

Single source for the ER diagram, the SRS data dictionary and the CDK table
definitions. Entities are grouped by bounded concern. Each attribute is
(name, type, key, note); key is "PK", "FK", "SK" or "".
"""

from __future__ import annotations

from collections.abc import Collection

# ---------------------------------------------------------------- entities
MODEL = {
"Tenancy and configuration": {

 "REGION_PACK": ("The locale a tenant operates in. Supplies everything country specific "
   "so a second country is a data change, not a code change. D-13.", [
    ("code", "string", "PK", "ISO country code, CM for Cameroon"),
    ("currency", "string", "", "XAF"),
    ("dialCode", "string", "", "+237"),
    ("msisdnPattern", "string", "", "Validation for mobile numbers"),
    ("languages", "list", "", "fr, en"),
    ("timezone", "string", "", "Africa/Douala"),
    ("administrativeRegions", "list", "", "The ten regions"),
    ("nationalIdPattern", "string", "", "CNI format"),
    ("publicHolidays", "list", "", "Used to suppress booking and reminders"),
    ("emergencyNumber", "string", "", "Shown on disruption notices"),
    ("smsSenderIdPolicy", "string", "", "Registration rules per network"),
    ("allowsRatingFeeLink", "bool", "", "False for CM. Enforces D-11 at the data layer"),
 ]),

 "TENANT": ("An institution using Atria. Every record below belongs to exactly one.", [
    ("tenantId", "string", "PK", ""),
    ("name", "string", "", ""),
    ("regionPackCode", "string", "FK", "REGION_PACK"),
    ("gridUnitMinutes", "int", "", "Calendar resolution, default 10. D-04"),
    ("qualityProgrammeEnabled", "bool", "", "Master switch for feedback collection. D-11"),
    ("ratingAffectsFee", "bool", "", "Refused when the region pack forbids it"),
    ("noShowStrikeThreshold", "int", "", "0 disables strikes, which is the default. D-07"),
    ("noShowStrikeWindowDays", "int", "", "Rolling window, default 180"),
    ("status", "enum", "", "ONBOARDING, ACTIVE, SUSPENDED"),
 ]),

 "CLINIC": ("A physical site within a tenant where appointments take place.", [
    ("clinicId", "string", "PK", ""),
    ("tenantId", "string", "FK", "TENANT"),
    ("name", "string", "", ""),
    ("address", "string", "", "Formatted per the region pack"),
    ("phone", "string", "", ""),
    ("openingHours", "json", "", "Per weekday"),
 ]),

 "APPOINTMENT_TYPE": ("What is being booked. Carries its own duration, which is the "
   "change that removes the single tenant wide slot length. D-04.", [
    ("appointmentTypeId", "string", "PK", ""),
    ("tenantId", "string", "FK", "TENANT"),
    ("code", "string", "", "GEN_CONSULT, SPEC_FIRST, MINOR_PROC"),
    ("name", "string", "", ""),
    ("serviceLine", "enum", "", "GENERAL, SPECIALIST, PROCEDURE. D-01"),
    ("durationUnits", "int", "", "In grid units. Null for queued general consultations"),
    ("bufferUnits", "int", "", "Turnaround held after the appointment"),
    ("bookableBy", "enum", "", "PATIENT, STAFF, BOTH. Procedures are STAFF. D-05"),
    ("patientRequestable", "bool", "", "Lets a patient raise a REQUESTED procedure. D-05"),
    ("minNoticeMinutes", "int", "", ""),
    ("maxAdvanceDays", "int", "", ""),
    ("cancellationWindowMinutes", "int", "", "Boundary between in window and late. D-07"),
    ("intakeFormId", "string", "FK", "INTAKE_FORM, nullable"),
    ("feeBandId", "string", "FK", "FEE_BAND"),
    ("active", "bool", "", ""),
 ]),

 "INTAKE_FORM": ("The questions asked at booking, chosen by appointment type. D-06.", [
    ("intakeFormId", "string", "PK", ""),
    ("tenantId", "string", "FK", "TENANT"),
    ("name", "string", "", ""),
    ("version", "int", "", "Answers pin the version they were captured against"),
    ("schema", "json", "", "Field definitions, types, required flags, translations"),
 ]),

 "FEE_BAND": ("The baseline fee for a practice, not for an individual. Set by the tenant "
   "administrator from the ministerial schedule. D-11.", [
    ("feeBandId", "string", "PK", ""),
    ("tenantId", "string", "FK", "TENANT"),
    ("practice", "string", "", "General practice, cardiology, paediatrics"),
    ("baseAmountMinor", "int", "", "Minor units of the region pack currency"),
    ("scheduleReference", "string", "", "The order the amount is taken from"),
    ("effectiveFrom", "date", "", ""),
 ]),
},

"Identity and consent": {

 "PERSON": ("One human being. Holds no role. This split is what lets a staff member be a "
   "patient without being able to act on their own appointment as staff. D-10.", [
    ("personId", "string", "PK", ""),
    ("cognitoSub", "string", "", "Identity provider subject"),
    ("givenName", "string", "", ""),
    ("familyName", "string", "", ""),
    ("dateOfBirth", "date", "", "Stored as a date. Age is derived, never stored. D-09"),
    ("phoneE164", "string", "", "Reminder channel"),
    ("phoneVerifiedAt", "datetime", "", "Set only by one time code, whatever the source"),
    ("email", "string", "", ""),
    ("preferredLanguage", "string", "", "From the region pack's language list"),
 ]),

 "PATIENT_PROFILE": ("A person as a patient of one tenant.", [
    ("patientProfileId", "string", "PK", ""),
    ("personId", "string", "FK", "PERSON"),
    ("tenantId", "string", "FK", "TENANT"),
    ("patientNumber", "string", "", "The clinic's own identifier"),
    ("guardianPersonId", "string", "FK", "PERSON, required while under 18. D-09"),
    ("notificationPrefs", "json", "", "Channel, lead times, proxy recipient"),
    ("noShowCount", "int", "", "Rolling count in the tenant's window"),
    ("bookingRestrictionUntil", "date", "", "Advance booking withheld until this date. D-07"),
 ]),

 "STAFF_MEMBERSHIP": ("A person's employment at one clinic, carrying their roles.", [
    ("staffMembershipId", "string", "PK", ""),
    ("personId", "string", "FK", "PERSON"),
    ("tenantId", "string", "FK", "TENANT"),
    ("clinicId", "string", "FK", "CLINIC"),
    ("roles", "list", "", "RECEPTIONIST, CLINICIAN, CLINIC_MANAGER, TENANT_ADMIN"),
    ("employeeNumber", "string", "", ""),
    ("status", "enum", "", "INVITED, ACTIVE, SUSPENDED, ENDED"),
 ]),

 "CLINICIAN_PROFILE": ("The bookable part of a staff membership. Only the facts Article 7 "
   "permits in a listing appear on the patient side. D-11.", [
    ("clinicianProfileId", "string", "PK", ""),
    ("staffMembershipId", "string", "FK", "STAFF_MEMBERSHIP"),
    ("specialty", "string", "", ""),
    ("qualifications", "list", "", "Officially recognised titles only"),
    ("registrationYear", "int", "", "Year entered on the Order's roll"),
    ("ordreNumber", "string", "", "Registration number"),
    ("languages", "list", "", ""),
    ("seniorityBand", "enum", "", "Derived from registrationYear. Sorts the directory "
                                  "without asserting a quality claim"),
 ]),

 "CONSENT_RECORD": ("Who consented to what, when and how. Required by Law 2024/017 and "
   "the evidence a pilot has to produce.", [
    ("consentRecordId", "string", "PK", ""),
    ("subjectPersonId", "string", "FK", "PERSON, whose data it is"),
    ("grantedByPersonId", "string", "FK", "PERSON, the guardian where the subject is a minor"),
    ("purpose", "enum", "", "BOOKING, REMINDERS, CARE_CONTEXT, FEEDBACK"),
    ("basis", "enum", "", "CONSENT, LEGAL_OBLIGATION, PUBLIC_INTEREST, VITAL_INTEREST"),
    ("method", "enum", "", "APP, WEB, DESK_SIGNATURE, SMS_REPLY"),
    ("authorityAuthorisationRef", "string", "", "Reference for a minor's sensitive data. OI-11"),
    ("grantedAt", "datetime", "", ""),
    ("withdrawnAt", "datetime", "", ""),
 ]),

 "PRIORITY_ALLOWANCE": ("An explicit, bounded, visible staff booking privilege. The "
   "alternative to a loophole. D-10 rule 5.", [
    ("priorityAllowanceId", "string", "PK", ""),
    ("staffMembershipId", "string", "FK", "STAFF_MEMBERSHIP"),
    ("quotaPerMonth", "int", "", ""),
    ("usedThisMonth", "int", "", ""),
    ("grantedByPersonId", "string", "FK", "PERSON"),
 ]),
},

"Scheduling": {

 "AVAILABILITY_TEMPLATE": ("A clinician's recurring working hours.", [
    ("availabilityTemplateId", "string", "PK", ""),
    ("clinicianProfileId", "string", "FK", "CLINICIAN_PROFILE"),
    ("clinicId", "string", "FK", "CLINIC"),
    ("weekday", "int", "", "0 to 6"),
    ("startTime", "time", "", ""),
    ("endTime", "time", "", ""),
    ("effectiveFrom", "date", "", ""),
    ("effectiveTo", "date", "", ""),
 ]),

 "AVAILABILITY_EXCEPTION": ("A one off change. Marking a clinician unavailable here is "
   "what starts a disruption. D-03.", [
    ("availabilityExceptionId", "string", "PK", ""),
    ("clinicianProfileId", "string", "FK", "CLINICIAN_PROFILE"),
    ("exceptionDate", "date", "", ""),
    ("kind", "enum", "", "UNAVAILABLE, EXTRA"),
    ("startTime", "time", "", ""),
    ("endTime", "time", "", ""),
    ("reason", "string", "", "Recorded, and shown to affected patients in general terms"),
 ]),

 "SESSION": ("A published block of general consultation capacity. Patients book a place "
   "in it rather than a named doctor. D-02.", [
    ("sessionId", "string", "PK", ""),
    ("tenantId", "string", "FK", "TENANT"),
    ("clinicId", "string", "FK", "CLINIC"),
    ("sessionDate", "date", "", ""),
    ("startTime", "time", "", ""),
    ("endTime", "time", "", ""),
    ("rosteredClinicianCount", "int", "", ""),
    ("expectedThroughputPerHour", "decimal", "", "Seeded, then corrected from measurement"),
    ("capacity", "int", "", "Derived, and the number the queue is capped at"),
    ("issuedTickets", "int", "", ""),
    ("actualThroughputPerHour", "decimal", "", "Written at close. Feeds next week's estimate"),
    ("status", "enum", "", "PLANNED, OPEN, RUNNING, DISRUPTED, CLOSED"),
 ]),

 "QUEUE_TICKET": ("A patient's place in a session. Position is assigned by the server from "
   "the request timestamp, which is D-10 rule 2.", [
    ("queueTicketId", "string", "PK", ""),
    ("sessionId", "string", "FK", "SESSION"),
    ("patientProfileId", "string", "FK", "PATIENT_PROFILE"),
    ("position", "int", "", "Server assigned, never client supplied"),
    ("arrivalWindowStart", "time", "", "Recalculated live as the session runs"),
    ("arrivalWindowEnd", "time", "", ""),
    ("state", "enum", "", "ISSUED, NOTIFIED, ARRIVED, IN_CONSULTATION, COMPLETED, NO_SHOW, WITHDRAWN"),
    ("assignedClinicianProfileId", "string", "FK", "CLINICIAN_PROFILE, set at check in"),
    ("appointmentId", "string", "FK", "APPOINTMENT"),
 ]),

 "SLOT_LOCK": ("The item whose existence prevents double booking. One per grid unit, all "
   "written in a single transaction so an N unit appointment is still atomic. D-04.", [
    ("lockKey", "string", "PK", "tenantId, clinicianProfileId and date"),
    ("unit", "string", "SK", "Start of the grid unit, HHMM"),
    ("appointmentId", "string", "FK", "APPOINTMENT"),
    ("expiresAt", "number", "", "TTL, releases an abandoned hold"),
 ]),

 "APPOINTMENT": ("The central record. Holds either a clinician and a time, or a session "
   "and a ticket, never both.", [
    ("appointmentId", "string", "PK", ""),
    ("tenantId", "string", "FK", "TENANT"),
    ("clinicId", "string", "FK", "CLINIC"),
    ("patientProfileId", "string", "FK", "PATIENT_PROFILE"),
    ("appointmentTypeId", "string", "FK", "APPOINTMENT_TYPE"),
    ("clinicianProfileId", "string", "FK", "CLINICIAN_PROFILE, null on the general line"),
    ("sessionId", "string", "FK", "SESSION, null on the specialist line"),
    ("startAt", "datetime", "", ""),
    ("endAt", "datetime", "", "Derived from the type's durationUnits"),
    ("state", "enum", "", "See the state machine"),
    ("channel", "enum", "", "ONLINE, WALK_IN, PHONE, REFERRAL. D-12"),
    ("bookedByPersonId", "string", "FK", "PERSON"),
    ("bookedByRole", "enum", "", "PATIENT or the staff role used. Blank means self service"),
    ("referralId", "string", "FK", "REFERRAL, nullable"),
    ("careContextId", "string", "FK", "CARE_CONTEXT, nullable"),
    ("version", "int", "", "Optimistic concurrency for offline staff writes"),
 ]),

 "APPOINTMENT_EVENT": ("Every transition, with who caused it and why. Drives the patient "
   "timeline and satisfies the audit obligation.", [
    ("appointmentEventId", "string", "PK", ""),
    ("appointmentId", "string", "FK", "APPOINTMENT"),
    ("kind", "enum", "", "BOOKED, CONFIRMED, RESCHEDULED, DISRUPTED, CANCELLED, ARRIVED, COMPLETED, NO_SHOW"),
    ("fromState", "enum", "", ""),
    ("toState", "enum", "", ""),
    ("actorPersonId", "string", "FK", "PERSON"),
    ("actorRole", "enum", "", ""),
    ("reason", "string", "", "Required on every staff initiated reschedule. D-10 rule 4"),
    ("occurredAt", "datetime", "", ""),
 ]),

 "REFERRAL": ("Where a specialist appointment came from. The normal door into the "
   "specialist line, matching the health pyramid. D-12.", [
    ("referralId", "string", "PK", ""),
    ("appointmentId", "string", "FK", "APPOINTMENT"),
    ("referringFacility", "string", "", ""),
    ("referringClinicianName", "string", "", ""),
    ("referralNote", "string", "", ""),
    ("documentKey", "string", "", "Object store key, encrypted at rest"),
    ("receivedAt", "datetime", "", ""),
 ]),

 "CARE_CONTEXT": ("What the patient chose to send ahead of one visit. Deliberately its own "
   "entity, its own key and its own shorter retention. D-06.", [
    ("careContextId", "string", "PK", ""),
    ("appointmentId", "string", "FK", "APPOINTMENT"),
    ("intakeFormId", "string", "FK", "INTAKE_FORM"),
    ("formVersion", "int", "", ""),
    ("answers", "encrypted", "", "Readable by the assigned clinician and the patient only"),
    ("consentRecordId", "string", "FK", "CONSENT_RECORD"),
    ("submittedAt", "datetime", "", ""),
    ("purgeAfter", "number", "", "TTL. Shorter than the booking history. D-08"),
 ]),
},

"Accountability and quality": {

 "FEE_LEDGER_ENTRY": ("What was owed and what the outcome entitles the patient to. Nothing "
   "settles until a payment provider arrives in Phase 3. D-07.", [
    ("feeLedgerEntryId", "string", "PK", ""),
    ("appointmentId", "string", "FK", "APPOINTMENT"),
    ("tenantId", "string", "FK", "TENANT"),
    ("feeBandId", "string", "FK", "FEE_BAND"),
    ("amountMinor", "int", "", ""),
    ("currency", "string", "", ""),
    ("outcome", "enum", "", "ATTENDED, CANCELLED_IN_WINDOW, CANCELLED_LATE, NO_SHOW, "
                            "CLINIC_CANCELLED, CLINIC_RESCHEDULED"),
    ("entitlement", "enum", "", "NONE, PARTIAL, FULL"),
    ("settledAt", "datetime", "", "Null throughout Phase 2"),
 ]),

 "FEEDBACK": ("Collected after the scheduled end, only where attendance was recorded. Seen "
   "by the tenant administrator. Never shown on a patient facing directory. D-11.", [
    ("feedbackId", "string", "PK", ""),
    ("appointmentId", "string", "FK", "APPOINTMENT"),
    ("patientProfileId", "string", "FK", "PATIENT_PROFILE"),
    ("clinicianProfileId", "string", "FK", "CLINICIAN_PROFILE"),
    ("waitingScore", "int", "", "1 to 5"),
    ("clarityScore", "int", "", ""),
    ("respectScore", "int", "", ""),
    ("wouldReturn", "bool", "", ""),
    ("comment", "string", "", ""),
    ("flagged", "bool", "", "Safety or conduct concern, escalated to the clinic manager"),
    ("submittedAt", "datetime", "", ""),
 ]),
},

"Messaging and audit": {

 "REMINDER": ("One scheduled send. Queued through SQS so a failure is parked and "
   "redrivable rather than lost. D-14.", [
    ("reminderId", "string", "PK", ""),
    ("appointmentId", "string", "FK", "APPOINTMENT"),
    ("channel", "enum", "", "SMS, EMAIL, VOICE"),
    ("leadMinutes", "int", "", ""),
    ("scheduledFor", "datetime", "", ""),
    ("state", "enum", "", "SCHEDULED, SENT, DELIVERED, FAILED, CANCELLED"),
    ("attempts", "int", "", ""),
    ("providerMessageId", "string", "", ""),
 ]),

 "MESSAGE_LOG": ("What was actually sent, to whom, and what the provider said.", [
    ("messageLogId", "string", "PK", ""),
    ("tenantId", "string", "FK", "TENANT"),
    ("recipientPersonId", "string", "FK", "PERSON"),
    ("reminderId", "string", "FK", "REMINDER, nullable"),
    ("channel", "enum", "", ""),
    ("template", "string", "", ""),
    ("deliveryState", "enum", "", ""),
    ("sentAt", "datetime", "", ""),
 ]),

 "AUDIT_ENTRY": ("Every privileged action. A legal obligation here, not a convenience.", [
    ("auditEntryId", "string", "PK", ""),
    ("tenantId", "string", "FK", "TENANT"),
    ("actorPersonId", "string", "FK", "PERSON"),
    ("actorRole", "enum", "", ""),
    ("action", "string", "", ""),
    ("subjectType", "string", "", ""),
    ("subjectId", "string", "", ""),
    ("reason", "string", "", ""),
    ("flags", "list", "", "POTENTIAL_SELF_BENEFIT raised by D-10 rule 3"),
    ("occurredAt", "datetime", "", ""),
 ]),
},
}

# ------------------------------------------------------------ relationships
# (left, cardinality, right, label)
RELATIONSHIPS = [
 ("REGION_PACK", "||--o{", "TENANT", "configures"),
 ("TENANT", "||--o{", "CLINIC", "operates"),
 ("TENANT", "||--o{", "APPOINTMENT_TYPE", "defines"),
 ("TENANT", "||--o{", "FEE_BAND", "sets"),
 ("TENANT", "||--o{", "INTAKE_FORM", "publishes"),
 ("FEE_BAND", "||--o{", "APPOINTMENT_TYPE", "prices"),
 ("INTAKE_FORM", "||--o{", "APPOINTMENT_TYPE", "asks for"),

 ("PERSON", "||--o{", "PATIENT_PROFILE", "is a patient as"),
 ("PERSON", "||--o{", "STAFF_MEMBERSHIP", "is staff as"),
 ("PERSON", "||--o{", "CONSENT_RECORD", "is subject of"),
 ("PATIENT_PROFILE", "}o--o|", "PERSON", "has guardian"),
 ("STAFF_MEMBERSHIP", "||--o|", "CLINICIAN_PROFILE", "may be bookable as"),
 ("STAFF_MEMBERSHIP", "||--o|", "PRIORITY_ALLOWANCE", "may hold"),
 ("CLINIC", "||--o{", "STAFF_MEMBERSHIP", "employs"),

 ("CLINICIAN_PROFILE", "||--o{", "AVAILABILITY_TEMPLATE", "works"),
 ("CLINICIAN_PROFILE", "||--o{", "AVAILABILITY_EXCEPTION", "varies by"),
 ("CLINIC", "||--o{", "SESSION", "publishes"),
 ("SESSION", "||--o{", "QUEUE_TICKET", "issues"),
 ("PATIENT_PROFILE", "||--o{", "QUEUE_TICKET", "holds"),
 ("CLINICIAN_PROFILE", "||--o{", "QUEUE_TICKET", "is assigned at check in"),

 ("PATIENT_PROFILE", "||--o{", "APPOINTMENT", "books"),
 ("APPOINTMENT_TYPE", "||--o{", "APPOINTMENT", "types"),
 ("CLINICIAN_PROFILE", "||--o{", "APPOINTMENT", "sees on the specialist line"),
 ("SESSION", "||--o{", "APPOINTMENT", "contains on the general line"),
 ("QUEUE_TICKET", "|o--||", "APPOINTMENT", "realises"),
 ("APPOINTMENT", "||--o{", "SLOT_LOCK", "holds one per grid unit"),
 ("APPOINTMENT", "||--o{", "APPOINTMENT_EVENT", "records"),
 ("APPOINTMENT", "||--o|", "REFERRAL", "may arrive by"),
 ("APPOINTMENT", "||--o|", "CARE_CONTEXT", "may carry"),
 ("CONSENT_RECORD", "||--o{", "CARE_CONTEXT", "authorises"),

 ("APPOINTMENT", "||--o|", "FEE_LEDGER_ENTRY", "closes to"),
 ("FEE_BAND", "||--o{", "FEE_LEDGER_ENTRY", "values"),
 ("APPOINTMENT", "||--o|", "FEEDBACK", "may be rated by"),
 ("CLINICIAN_PROFILE", "||--o{", "FEEDBACK", "receives"),

 ("APPOINTMENT", "||--o{", "REMINDER", "schedules"),
 ("REMINDER", "||--o|", "MESSAGE_LOG", "sends"),
 ("PERSON", "||--o{", "MESSAGE_LOG", "receives"),
 ("PERSON", "||--o{", "AUDIT_ENTRY", "acts in"),
]

# --------------------------------------------------------------- emitters
def mermaid(subset: Collection[str] | None = None, max_attrs: int = 6) -> str:
    """Emit a Mermaid erDiagram. `subset` limits entities for a focused view."""
    ents: dict[str, list[tuple[str, str, str, str]]] = {}
    for group in MODEL.values():
        for name, (_desc, attrs) in group.items():
            if subset is None or name in subset:
                ents[name] = attrs
    out = ["erDiagram"]
    for a, card, b, label in RELATIONSHIPS:
        if a in ents and b in ents:
            out.append(f'    {a} {card} {b} : "{label}"')
    for name, attrs in ents.items():
        keyed = [x for x in attrs if x[2]]
        rest = [x for x in attrs if not x[2]]
        shown = keyed + rest[: max(0, max_attrs - len(keyed))]
        out.append(f"    {name} {{")
        for n, t, k, _note in shown:
            # Mermaid ER only understands PK, FK and UK. A composite sort key
            # is emitted as part of the primary key.
            mk = "PK" if k == "SK" else k
            out.append(f"        {t} {n}{(' ' + mk) if mk in ('PK', 'FK', 'UK') else ''}")
        out.append("    }")
    return "\n".join(out)


def counts() -> tuple[int, int, int]:
    ents = sum(len(g) for g in MODEL.values())
    attrs = sum(len(a) for g in MODEL.values() for _d, a in g.values())
    return ents, attrs, len(RELATIONSHIPS)


if __name__ == "__main__":
    e, a, r = counts()
    print(f"{e} entities, {a} attributes, {r} relationships")
    print(mermaid())
