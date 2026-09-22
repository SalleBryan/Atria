# Constraints

These are facts about the environment Atria is deployed into. They are not negotiable by
the project, and the architecture decisions answer to them.

## C-01 Staffing

Most facilities do not have two doctors on site, and emergency cover is the scarcest resource.
The platform must never promise a named doctor at a minute for general consultations.

Answered by: AD-02, AD-03

## C-02 Professional conduct and fees

Fees follow a ministerial schedule and publicity about named doctors is prohibited. Ratings must
not change prices or appear on a named clinician's listing.

Answered by: AD-11

## C-03 Personal data law

Law No. 2024/017 governs health data, requires prior authorisation for processing and for
transfer abroad, and places minors' sensitive data under prior authorisation. Development runs
on synthetic data only.

Answered by: AD-06, AD-09, AD-13, section 5.4

## C-04 Connectivity

SMS is the primary reminder channel because mobile subscriptions far exceed internet use.
Clients degrade gracefully offline.

Answered by: AD-02, section 5.6
