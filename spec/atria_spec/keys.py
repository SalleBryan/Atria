"""Atria Rev B DynamoDB table design.

Single source for the CDK table definitions, the data access layer and the
Technical Document key tables. One main table, one care context table on its own
customer-managed key.

KEYS rows are (entity, partition key pattern, sort key pattern, table).
INDEXES rows are (name, partition key, sort key, what it answers).
"""

KEYS = [
    ('Tenant', 'TENANT#t', 'META', 'Main'),
    ('Region pack', 'REGION#code', 'PACK', 'Main'),
    ('Clinic', 'TENANT#t#CLINIC#c', 'PROFILE', 'Main'),
    ('Appointment type', 'TENANT#t#TYPE#id', 'TYPE', 'Main'),
    ('Intake form', 'TENANT#t#FORM#id', 'V#version', 'Main'),
    ('Fee band', 'TENANT#t#FEE#id', 'FROM#effectiveFrom', 'Main'),
    ('Person', 'PERSON#p', 'PERSON', 'Main'),
    ('Patient profile', 'TENANT#t#PAT#pp', 'PROFILE', 'Main'),
    ('Staff membership', 'TENANT#t#STAFF#s', 'MEMBERSHIP', 'Main'),
    ('Clinician profile', 'TENANT#t#STAFF#s', 'CLINICIAN', 'Main'),
    ('Consent record', 'PERSON#p', 'CONSENT#grantedAt#id', 'Main'),
    ('Priority allowance', 'TENANT#t#STAFF#s', 'PRIORITY', 'Main'),
    ('Availability template', 'TENANT#t#CLIN#c', 'AVAIL#weekday', 'Main'),
    ('Availability exception', 'TENANT#t#CLIN#c', 'EXC#start', 'Main'),
    ('Session', 'TENANT#t#SESSION#id', 'SESSION', 'Main'),
    ('Queue ticket', 'TENANT#t#SESSION#id', 'TICKET#requestTs#ticketId', 'Main'),
    ('Slot lock', 'TENANT#t#LOCK#clinicianId#unitStart', 'LOCK', 'Main'),
    ('Appointment', 'TENANT#t#APPT#id', 'APPT', 'Main'),
    ('Appointment event', 'TENANT#t#APPT#id', 'EVENT#ts#eventId', 'Main'),
    ('Referral', 'TENANT#t#APPT#id', 'REFERRAL', 'Main'),
    ('Fee ledger entry', 'TENANT#t#APPT#id', 'LEDGER', 'Main'),
    ('Feedback', 'TENANT#t#APPT#id', 'FEEDBACK', 'Main'),
    ('Reminder', 'TENANT#t#APPT#id', 'REMINDER#sendAt', 'Main'),
    ('Message log', 'TENANT#t#MSG#yyyy-mm-dd', 'sentAt#messageId', 'Main'),
    ('Audit entry', 'TENANT#t#AUDIT#yyyy-mm-dd', 'ts#auditId', 'Main'),
    ('Care context', 'TENANT#t#APPT#id', 'CARE', 'Care context table, own key, TTL'),
]

INDEXES = [
    ('PatientIndex', 'patientProfileId', 'startAt', "A patient's own appointments and tickets, all four range views"),
    ('ClinicianIndex', 'clinicianProfileId', 'startAt', "A clinician's calendar"),
    ('ClinicDayIndex', 'clinicId#date', 'startAt', 'The clinic day, the week and the requests inbox'),
    ('PersonIndex', 'cognitoSub', 'none', 'Resolving the signed-in person on every request'),
    ('OutboxIndex', 'outboxShard', 'createdAt', 'Change capture into the FIFO outbox, keyed on appointment id'),
    ('DirectoryIndex', 'directoryKey', 'directorySort', 'The bookable clinicians of one tenant, most senior first'),
]

# DirectoryIndex is sparse on purpose. A clinician profile carries directoryKey
# only while the account is bookable, so suspending an account drops it out of
# the directory rather than leaving it listed for a patient to choose and the
# booking service to refuse. directorySort is registrationYear#familyName#staffId,
# which sorts most senior first without going stale as the years pass, unlike
# the seniority band, which is derived at creation.

MAIN_TABLE = "Main"
CARE_CONTEXT_TABLE = "Care context table, own key, TTL"
