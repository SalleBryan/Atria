"""Atria Rev B role and permission model.

Single source for the API authoriser policy, the screen visibility rules, the
SRS permission matrix and the use case diagram actors. If a permission is not
listed here it does not exist.

Scope values
    own      the actor's own records only
    clinic   every record in the actor's clinic
    tenant   every record in the tenant
    none     refused

The authoriser is the enforcement point. Screens hide what a role cannot do;
the authoriser is what actually refuses it. D-10.
"""

from __future__ import annotations

ROLES = ["PATIENT", "RECEPTIONIST", "CLINICIAN", "CLINIC_MANAGER", "TENANT_ADMIN"]

ROLE_NOTES = {
 "PATIENT": "Held through a patient profile, never through a staff membership. "
            "A staff member acting on their own appointment gets this role only.",
 "RECEPTIONIST": "The front desk. Runs the day, never sees clinical context.",
 "CLINICIAN": "A bookable health professional. Sees care context for their own "
              "patients and nobody else's.",
 "CLINIC_MANAGER": "Runs one clinic. Adds the rota, reporting and the reschedule "
                   "audit list on top of the receptionist's day.",
 "TENANT_ADMIN": "Runs the institution. Deliberately cannot read care context.",
}

# permission -> {role: scope}
MATRIX = {

 # ---- booking -------------------------------------------------------------
 "appointment.read":        {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"tenant"},
 "appointment.create":      {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"clinic",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "appointment.reschedule":  {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "appointment.cancel":      {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "appointment.check_in":    {"PATIENT":"none","RECEPTIONIST":"clinic","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "appointment.mark_no_show":{"PATIENT":"none","RECEPTIONIST":"clinic","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "procedure.size_and_place":{"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "procedure.request":       {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"clinic",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},

 # ---- clinical context ----------------------------------------------------
 "care_context.read":       {"PATIENT":"own","RECEPTIONIST":"none","CLINICIAN":"own",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"none"},
 "care_context.write":      {"PATIENT":"own","RECEPTIONIST":"none","CLINICIAN":"own",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"none"},

 # ---- schedule ------------------------------------------------------------
 "availability.read":       {"PATIENT":"none","RECEPTIONIST":"clinic","CLINICIAN":"clinic",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"tenant"},
 "availability.write":      {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "session.publish":         {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "session.disrupt":         {"PATIENT":"none","RECEPTIONIST":"clinic","CLINICIAN":"clinic",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "queue.assign_next":       {"PATIENT":"none","RECEPTIONIST":"clinic","CLINICIAN":"clinic",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},

 # ---- people --------------------------------------------------------------
 "patient.read":            {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"tenant"},
 "patient.create":          {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"clinic",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "patient.update":          {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"none",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"none"},
 "staff.create":            {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},
 "staff.update_roles":      {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},
 "staff.suspend":           {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},
 "priority_allowance.grant":{"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},

 # ---- institution ---------------------------------------------------------
 "clinic.manage":           {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},
 "appointment_type.manage": {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},
 "fee_band.manage":         {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},
 "region_pack.choose":      {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},
 "feature_flag.set":        {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"tenant"},

 # ---- quality and money ---------------------------------------------------
 "feedback.submit":         {"PATIENT":"own","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"none","TENANT_ADMIN":"none"},
 "feedback.read":           {"PATIENT":"own","RECEPTIONIST":"none","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"tenant"},
 "fee_ledger.read":         {"PATIENT":"own","RECEPTIONIST":"clinic","CLINICIAN":"none",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"tenant"},

 # ---- oversight -----------------------------------------------------------
 "audit.read":              {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"none",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"tenant"},
 "report.read":             {"PATIENT":"none","RECEPTIONIST":"none","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"tenant"},
 "message.send":            {"PATIENT":"none","RECEPTIONIST":"clinic","CLINICIAN":"own",
                             "CLINIC_MANAGER":"clinic","TENANT_ADMIN":"tenant"},
}

# Rules the matrix alone cannot express. Evaluated by the authoriser after the
# matrix grants, and able only to refuse. D-10.
GUARD_RULES = [
 ("SELF_SUBJECT_DROPS_STAFF_SCOPE",
  "Where the actor's personId equals the subject's personId, every staff scope "
  "is dropped and only the PATIENT row applies. A staff member can never act on "
  "their own appointment through staff tooling."),
 ("SERVER_ASSIGNED_ORDER",
  "Queue position and slot allocation are derived from the request timestamp on "
  "the server. A client supplied position or ordering field is rejected, not "
  "ignored."),
 ("NO_SELF_BENEFITING_RESCHEDULE",
  "A staff action that moves another patient later is refused where the actor "
  "holds an appointment in the same session or the adjoining slot window. A "
  "CLINIC_MANAGER may still perform it, which keeps genuine cases possible."),
 ("REASONED_AND_AUDITED",
  "Every staff initiated reschedule or cancellation requires a reason and writes "
  "an AUDIT_ENTRY. Where the actor holds an appointment in the affected window "
  "the entry carries POTENTIAL_SELF_BENEFIT for the clinic manager's weekly list."),
 ("BOUNDED_PRIORITY",
  "Staff priority exists only as a PRIORITY_ALLOWANCE granted by a tenant "
  "administrator, with a monthly quota, visible on the admin dashboard. There is "
  "no implicit staff priority anywhere."),
 ("REGION_REFUSES_FEE_LINK",
  "Setting tenant.ratingAffectsFee is refused where the region pack's "
  "allowsRatingFeeLink is false. Enforced in the region pack, not the screen, so "
  "it cannot be bypassed through the API. D-11."),
 ("TENANT_ADMIN_NEVER_READS_CARE_CONTEXT",
  "care_context.read is none for TENANT_ADMIN and there is no override. The "
  "administrative role and the clinical role are separated on purpose."),
]

# Where each role lands after sign in, and what the role switcher offers.
LANDING = {
 "PATIENT": "Upcoming visits",
 "RECEPTIONIST": "Today at this clinic",
 "CLINICIAN": "My calendar",
 "CLINIC_MANAGER": "Clinic overview and rota",
 "TENANT_ADMIN": "Tenant overview",
}

# Fields the create user flow requires, by role. Enforced in the service, not
# only the form.
REQUIRED_ON_CREATE = {
 "RECEPTIONIST":   ["givenName", "familyName", "phoneE164", "clinicId"],
 "CLINICIAN":      ["givenName", "familyName", "phoneE164", "clinicId",
                    "specialty", "registrationYear", "ordreNumber", "languages"],
 "CLINIC_MANAGER": ["givenName", "familyName", "phoneE164", "clinicId"],
 "TENANT_ADMIN":   ["givenName", "familyName", "phoneE164", "email"],
}


def scope_for(role: str, permission: str) -> str:
    return MATRIX.get(permission, {}).get(role, "none")


def permissions_for(role: str) -> dict[str, str]:
    return {p: r[role] for p, r in MATRIX.items() if r[role] != "none"}


if __name__ == "__main__":
    print(f"{len(MATRIX)} permissions, {len(ROLES)} roles, {len(GUARD_RULES)} guard rules")
    for r in ROLES:
        print(f"  {r:<16} {len(permissions_for(r)):>2} permissions, lands on {LANDING[r]}")
