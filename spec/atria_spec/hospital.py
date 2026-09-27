"""The demonstration tenant: the Regional Hospital Buea, as the public record describes it.

Phase 2 is accepted on synthetic data at a hypothetical deployment in the
Regional Hospital Buea (decided 2026-09-26). The institution's shape here is
taken from what is published about it; everything about the people is
invented.

From the public record:

    A 120-bed regional referral hospital in Buea, South-West Region, with
    about 200 staff, serving a population of about 90,000, and a teaching
    hospital of the University of Buea's Faculty of Health Sciences. Its
    units, each headed by a specialist: the medical unit (male and female),
    the surgical unit, paediatrics, maternity, the HIV/AIDS unit, the
    laboratory, X-ray, the haemodialysis centre, the tuberculosis centre, the
    diabetes centre, the theatre and the outpatient department. Services:
    medicine, paediatrics, obstetrics, gynaecology, surgery, dentistry, eye
    care, radiology and haemodialysis.

    Sources: Eno et al., "Driving hospital transformation with SLMTA in
    a regional hospital in Cameroon", African Journal of Laboratory Medicine,
    2014 (PMC5637806); all-about-cameroon-today.com, "The Buea Regional
    Hospital".

What Atria books is outpatient care, so the units below are the places a
patient is seen by appointment or in the outpatient queue. The laboratory,
X-ray and theatre are reached through a clinician's order rather than booked
by a patient, and the wards are inpatient, so none of them is a unit here.
Dentistry and eye care are named services without a named unit in the
record; each is given one, as a hospital of this size runs them.

No staff roster is published, and none is used: every name, number and roll
entry below is invented, so no real person is shown with hours, leave or
visits they never had. Phone numbers are drawn at seeding time from ranges
reserved for fiction (tools/devkit.py).

Opening hours are the unit's outpatient hours, Monday (0) to Saturday (5), in
Africa/Douala. They are this project's assumption of a public hospital's
outpatient day, not a published timetable.
"""

from __future__ import annotations

from typing import Any

NAME = "Regional Hospital Buea"
PLACE = "Buea, South-West Region"
ADDRESS = "Regional Hospital Buea, Buea, South-West Region"
REGION = "Sud-Ouest"
PROFILE = (
    "A 120-bed regional referral hospital and a teaching hospital of the University of "
    "Buea's Faculty of Health Sciences."
)

_WEEKDAYS = {str(day): {"start": "07:30", "end": "15:30"} for day in range(5)}
_WEEKDAYS_AND_SATURDAY = {**_WEEKDAYS, "5": {"start": "08:00", "end": "12:00"}}
_OPD = {**{str(day): {"start": "07:30", "end": "17:00"} for day in range(5)}, "5": {"start": "08:00", "end": "13:00"}}
_DIALYSIS = {str(day): {"start": "07:00", "end": "19:00"} for day in range(6)}


def _days(*weekdays: int, start: str = "07:30", end: str = "15:30") -> dict[str, dict[str, str]]:
    return {str(day): {"start": start, "end": end} for day in weekdays}


# id, name, what it sees, the lines it offers, its outpatient hours.
UNITS: list[dict[str, Any]] = [
    {
        "clinicId": "u-rhb-opd",
        "name": "General Outpatient Department",
        "description": (
            "First contact for adults and children. General consultations in the day's queue,"
            " walk-ins welcome."
        ),
        "services": ["General consultation", "Referral to a specialist unit"],
        "lines": ["GENERAL"],
        "openingHours": _OPD,
    },
    {
        "clinicId": "u-rhb-medicine",
        "name": "Medical Unit",
        "description": "Internal medicine clinics for adults, with cardiology and dermatology sessions.",
        "services": ["Internal medicine", "Cardiology", "Dermatology"],
        "lines": ["SPECIALIST"],
        "openingHours": _WEEKDAYS,
    },
    {
        "clinicId": "u-rhb-surgery",
        "name": "Surgical Unit",
        "description": "Surgical clinics, follow-up after an operation, and minor procedures.",
        "services": ["General surgery", "Orthopaedics", "Minor procedures"],
        "lines": ["SPECIALIST", "PROCEDURE"],
        "openingHours": _WEEKDAYS,
    },
    {
        "clinicId": "u-rhb-paediatrics",
        "name": "Paediatrics Unit",
        "description": "Children from birth to 15, well-child checks and paediatric clinics.",
        "services": ["Paediatrics", "Child growth and nutrition"],
        "lines": ["SPECIALIST"],
        "openingHours": _WEEKDAYS_AND_SATURDAY,
    },
    {
        "clinicId": "u-rhb-maternity",
        "name": "Maternity Unit",
        "description": "Antenatal care, obstetrics and gynaecology clinics.",
        "services": ["Antenatal care", "Obstetrics", "Gynaecology", "Family planning"],
        "lines": ["SPECIALIST", "PROCEDURE"],
        "openingHours": _WEEKDAYS_AND_SATURDAY,
    },
    {
        "clinicId": "u-rhb-dental",
        "name": "Dental Unit",
        "description": "Check-ups, extractions, fillings and scaling.",
        "services": ["Dentistry"],
        "lines": ["SPECIALIST", "PROCEDURE"],
        "openingHours": _WEEKDAYS,
    },
    {
        "clinicId": "u-rhb-eye",
        "name": "Eye Unit",
        "description": "Eye examinations, glasses and eye disease clinics.",
        "services": ["Ophthalmology", "Refraction"],
        "lines": ["SPECIALIST"],
        "openingHours": _WEEKDAYS,
    },
    {
        "clinicId": "u-rhb-diabetes",
        "name": "Diabetes Centre",
        "description": "Diabetes and hypertension follow-up, foot checks and education.",
        "services": ["Diabetes care", "Hypertension follow-up"],
        "lines": ["SPECIALIST"],
        "openingHours": _days(0, 2, 4),
    },
    {
        "clinicId": "u-rhb-dialysis",
        "name": "Haemodialysis Centre",
        "description": "Scheduled haemodialysis sessions for patients already under the centre's care.",
        "services": ["Haemodialysis"],
        "lines": ["PROCEDURE"],
        "openingHours": _DIALYSIS,
    },
    {
        "clinicId": "u-rhb-hiv",
        "name": "HIV Care and Treatment Unit",
        "description": "Testing and counselling, treatment starts and follow-up, confidential.",
        "services": ["HIV testing and counselling", "Antiretroviral follow-up"],
        "lines": ["SPECIALIST"],
        "openingHours": _WEEKDAYS,
    },
    {
        "clinicId": "u-rhb-tb",
        "name": "Tuberculosis Centre",
        "description": "Diagnosis, directly observed treatment and follow-up.",
        "services": ["Tuberculosis care"],
        "lines": ["SPECIALIST"],
        "openingHours": _days(0, 1, 2, 3, 4, start="08:00", end="14:00"),
    },
]

UNIT_IDS = [unit["clinicId"] for unit in UNITS]
SPECIALIST_UNITS = [unit["clinicId"] for unit in UNITS if "SPECIALIST" in unit["lines"]]

# Fee bands in XAF, decided 2026-09-26 in the absence of a current official
# schedule. Recorded in the ledger only; no money moves before Phase 3.
FEE_BANDS: list[dict[str, Any]] = [
    {"feeBandId": "fb-general", "practice": "General consultation", "baseAmountMinor": 1500},
    {"feeBandId": "fb-specialist-first", "practice": "Specialist, first visit", "baseAmountMinor": 5000},
    {"feeBandId": "fb-specialist-follow", "practice": "Specialist, follow-up", "baseAmountMinor": 3000},
    {"feeBandId": "fb-minor-procedure", "practice": "Minor procedure", "baseAmountMinor": 10000},
    {"feeBandId": "fb-major-procedure", "practice": "Major procedure", "baseAmountMinor": 25000},
]
FEE_SCHEDULE_REFERENCE = "Atria fair rates, 2026-09-26 (no current official schedule found)"

# What can be booked. clinicIds, where present, limits a type to those units;
# absent, it is offered wherever its line is.
APPOINTMENT_TYPES: list[dict[str, Any]] = [
    {
        "appointmentTypeId": "at-gen-consult",
        "code": "GEN_CONSULT",
        "name": "General consultation",
        "serviceLine": "GENERAL",
        "durationUnits": None,
        "bufferUnits": 0,
        "bookableBy": "BOTH",
        "feeBandId": "fb-general",
        "clinicIds": ["u-rhb-opd"],
    },
    {
        "appointmentTypeId": "at-spec-first",
        "code": "SPEC_FIRST",
        "name": "First specialist consultation",
        "serviceLine": "SPECIALIST",
        "durationUnits": 3,
        "bufferUnits": 1,
        "bookableBy": "BOTH",
        "feeBandId": "fb-specialist-first",
        "clinicIds": SPECIALIST_UNITS,
    },
    {
        "appointmentTypeId": "at-spec-follow",
        "code": "SPEC_FOLLOW",
        "name": "Specialist follow-up",
        "serviceLine": "SPECIALIST",
        "durationUnits": 2,
        "bufferUnits": 1,
        "bookableBy": "BOTH",
        "feeBandId": "fb-specialist-follow",
        "clinicIds": SPECIALIST_UNITS,
    },
    {
        "appointmentTypeId": "at-antenatal",
        "code": "ANTENATAL",
        "name": "Antenatal visit",
        "serviceLine": "SPECIALIST",
        "durationUnits": 2,
        "bufferUnits": 1,
        "bookableBy": "BOTH",
        "feeBandId": "fb-specialist-follow",
        "clinicIds": ["u-rhb-maternity"],
    },
    {
        "appointmentTypeId": "at-dental-check",
        "code": "DENTAL_CHECK",
        "name": "Dental check-up",
        "serviceLine": "SPECIALIST",
        "durationUnits": 2,
        "bufferUnits": 1,
        "bookableBy": "BOTH",
        "feeBandId": "fb-specialist-follow",
        "clinicIds": ["u-rhb-dental"],
    },
    {
        "appointmentTypeId": "at-minor-proc",
        "code": "MINOR_PROC",
        "name": "Minor procedure",
        "serviceLine": "PROCEDURE",
        "durationUnits": 6,
        "bufferUnits": 2,
        "bookableBy": "STAFF",
        "patientRequestable": True,
        "feeBandId": "fb-minor-procedure",
        "clinicIds": ["u-rhb-surgery", "u-rhb-maternity", "u-rhb-dental"],
    },
    {
        "appointmentTypeId": "at-major-proc",
        "code": "MAJOR_PROC",
        "name": "Major procedure consultation",
        "serviceLine": "PROCEDURE",
        "durationUnits": 9,
        "bufferUnits": 3,
        "bookableBy": "STAFF",
        "patientRequestable": True,
        "feeBandId": "fb-major-procedure",
        "clinicIds": ["u-rhb-surgery", "u-rhb-maternity"],
    },
    {
        "appointmentTypeId": "at-dialysis",
        "code": "DIALYSIS",
        "name": "Haemodialysis session",
        "serviceLine": "PROCEDURE",
        "durationUnits": 24,
        "bufferUnits": 3,
        "bookableBy": "STAFF",
        "feeBandId": "fb-major-procedure",
        "clinicIds": ["u-rhb-dialysis"],
    },
]

# Invented clinicians: (given, family, specialty, year on the roll, unit, languages).
# The first six have been in the development directory since Phase 1 and keep
# their names, so bookings already made still name the right person.
CLINICIANS: list[tuple[str, str, str, int, str, list[str]]] = [
    ("Esther", "Mbarga", "Paediatrics", 2008, "u-rhb-paediatrics", ["en", "fr"]),
    ("Jean-Paul", "Nkoulou", "Cardiology", 1999, "u-rhb-medicine", ["en", "fr"]),
    ("Aicha", "Bello", "Dermatology", 2015, "u-rhb-medicine", ["en", "fr"]),
    ("Ernest", "Tabi", "Internal medicine", 2010, "u-rhb-medicine", ["en"]),
    ("Samuel", "Tchoupo", "Gynaecology", 2011, "u-rhb-maternity", ["en", "fr"]),
    ("Grace", "Fonkou", "Ophthalmology", 2019, "u-rhb-eye", ["en"]),
    ("Emmanuel", "Ekane", "General surgery", 2004, "u-rhb-surgery", ["en"]),
    ("Beatrice", "Ngwa", "Orthopaedics", 2013, "u-rhb-surgery", ["en", "fr"]),
    ("Clarisse", "Enow", "Obstetrics", 2016, "u-rhb-maternity", ["en"]),
    ("Divine", "Tanyi", "Paediatrics", 2020, "u-rhb-paediatrics", ["en"]),
    ("Florence", "Ashu", "Dentistry", 2014, "u-rhb-dental", ["en", "fr"]),
    ("Hilary", "Eyong", "Endocrinology", 2009, "u-rhb-diabetes", ["en"]),
    ("Irene", "Molua", "Nephrology", 2012, "u-rhb-dialysis", ["en", "fr"]),
    ("Joseph", "Nfor", "Infectious diseases", 2007, "u-rhb-hiv", ["en", "fr"]),
    ("Linda", "Etchu", "Pulmonology", 2017, "u-rhb-tb", ["en"]),
    ("Walters", "Mbua", "General practice", 2018, "u-rhb-opd", ["en"]),
    ("Pauline", "Nkwelle", "General practice", 2021, "u-rhb-opd", ["en", "fr"]),
    ("Roland", "Fomum", "General practice", 2016, "u-rhb-opd", ["en"]),
]

# Invented front desk and unit managers: (given, family, unit, role).
DESK_AND_MANAGERS: list[tuple[str, str, str, str]] = [
    ("Nadine", "Fotso", "u-rhb-medicine", "RECEPTIONIST"),
    ("Kofi", "Ngassa", "u-rhb-opd", "RECEPTIONIST"),
    ("Mercy", "Ebai", "u-rhb-opd", "RECEPTIONIST"),
    ("Collins", "Takang", "u-rhb-surgery", "RECEPTIONIST"),
    ("Judith", "Oben", "u-rhb-maternity", "RECEPTIONIST"),
    ("Rodrigue", "Owona", "u-rhb-medicine", "CLINIC_MANAGER"),
    ("Agnes", "Besong", "u-rhb-opd", "CLINIC_MANAGER"),
    ("Peter", "Arrey", "u-rhb-maternity", "CLINIC_MANAGER"),
]

# The tenant's settings as agreed on 2026-09-27 (Phase 2 plan, open items).
TENANT_SETTINGS: dict[str, Any] = {
    "gridUnitMinutes": 10,
    "languages": ["en", "fr"],
    "reminderLeadHours": 24,
    # A second reminder is off; when switched on it goes 2 hours before.
    "secondReminderHours": 0,
    "queueMoveThresholdMinutes": 30,
    # Strikes are off; the threshold offered when they are switched on is 3.
    "noShowStrikeThreshold": 0,
    "noShowStrikeWindowDays": 180,
    "qualityProgrammeEnabled": False,
    "ratingAffectsFee": False,
    "guardianConsent": "DESK_OR_GUARDIAN_ACCOUNT",
    "smsSenderId": "RHBUEA",
    "emailSenderName": "Regional Hospital Buea",
}


def unit(clinic_id: str) -> dict[str, Any]:
    for found in UNITS:
        if found["clinicId"] == clinic_id:
            return found
    raise KeyError(clinic_id)
