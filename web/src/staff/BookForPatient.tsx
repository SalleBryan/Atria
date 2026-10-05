/**
 * Booking for a patient at the desk (FR-BKG-07, FR-STF-14).
 *
 * Who, how they reached the desk, with whom, and when, in that order. The
 * patient comes from the register (or is added there first); the channel is
 * a walk-in, a phone call with the number to call back on, or a referral with
 * where it came from, and never "online", which only a patient's own booking
 * is. A walk-in is for today; a referral is for a specialist visit or a
 * procedure. The booking is recorded against the staff account.
 *
 * A clinician books only themselves (user, 2026-10-05; the API's
 * appointment.create is "own" for them): the clinician is fixed, not picked,
 * and the visit type starts on the specialist follow-up.
 *
 * Extends the console's look: Availability's two glass cards, the platform's
 * pickers and segmented control, and the Move dialog's day and time choice.
 */

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../api/client";
import { type CountryCode, HOME_COUNTRY, nationalInput, normalisePhone } from "../auth/phone";
import { useSession } from "../auth/session";
import { Field, Notice } from "../components/controls";
import { Calendar, Close, Plus, Search, Stethoscope } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { PhoneField } from "../components/PhoneField";
import { SelectMenu } from "../components/Pickers";
import { type Slot, WeekSlots } from "../components/WeekSlots";
import { type Appointment, clock, initials, offeredAt } from "../patient/data";
import { clinicianBooks, doctor, roleOf, useStaffData } from "./data";
import { sentence } from "./labels";
import { age, fullName, NewPatient, phoneShown, type RegisterEntry, useRegisterSearch } from "./Patients";

type Channel = "WALK_IN" | "PHONE" | "REFERRAL";

const CHANNELS: { id: Channel; label: string; hint: string }[] = [
  { id: "WALK_IN", label: "Walk-in", hint: "They are at the desk. Booked for today." },
  { id: "PHONE", label: "Phone", hint: "They called. Note the number to call back on." },
  { id: "REFERRAL", label: "Referral", hint: "Sent by another facility. Specialist visits and procedures only." },
];

export function BookForPatient() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const selfOnly = role === "CLINICIAN";
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [patient, setPatient] = useState<RegisterEntry | null>(null);
  const [patientId, setPatientId] = useState<string | null>(params.get("patient"));
  const [query, setQuery] = useState("");
  const { results, busy: searching } = useRegisterSearch(patient ? "" : query);
  const [adding, setAdding] = useState(false);

  const [channel, setChannel] = useState<Channel>("PHONE");
  const [callback, setCallback] = useState("");
  const [callbackCountry, setCallbackCountry] = useState<CountryCode>(HOME_COUNTRY);
  const [facility, setFacility] = useState("");
  // A number on the register is stored with its country code: split it into
  // the flag and the national number, or a +1 number read as "+237 (202)...".
  const takeCallback = (e164: string | null | undefined) => {
    const split = nationalInput(e164 ?? "", HOME_COUNTRY);
    setCallbackCountry(split.country);
    setCallback(split.text);
  };
  const [referrer, setReferrer] = useState("");
  const [note, setNote] = useState("");

  const [clinicianId, setClinicianId] = useState<string | null>(selfOnly ? (me?.staffId ?? null) : params.get("clinician"));
  const [typeId, setTypeId] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [fresh, setFresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A patient named in the address: read their register entry for the card.
  useEffect(() => {
    if (!patientId || patient?.patientProfileId === patientId) return;
    let live = true;
    api<RegisterEntry>(`/patients/${encodeURIComponent(patientId)}`)
      .then((found) => {
        if (!live) return;
        setPatient(found);
        if (!callback) takeCallback(found.phoneE164);
      })
      .catch(() => live && setPatientId(null));
    return () => {
      live = false;
    };
  }, [patientId, patient?.patientProfileId]);

  const clinicians = useMemo(() => {
    if (directory.status !== "ready") return [];
    const all = directory.data.clinicians;
    // The desk books in its own unit; an administrator anywhere; a clinician
    // only themselves.
    if (selfOnly) return all.filter((c) => c.clinicianProfileId === me?.staffId);
    return role === "TENANT_ADMIN" ? all : all.filter((c) => c.clinicId === me?.clinicId || c.clinicianProfileId === me?.staffId);
  }, [directory, role, selfOnly, me?.clinicId, me?.staffId]);
  const clinician = clinicians.find((c) => c.clinicianProfileId === clinicianId);
  const types = useMemo(() => {
    if (directory.status !== "ready" || !clinician) return [];
    return directory.data.types.filter(
      (t) =>
        t.durationUnits &&
        t.bookableBy !== "PATIENT" &&
        offeredAt(t, clinician.clinicId) &&
        (channel !== "REFERRAL" || t.serviceLine === "SPECIALIST" || t.serviceLine === "PROCEDURE"),
    );
  }, [directory, clinician, channel]);
  // A clinician booking is most often the next visit with them.
  const preferred = selfOnly ? types.find((t) => t.code === "SPEC_FOLLOW") : undefined;
  const type = types.find((t) => t.appointmentTypeId === typeId) ?? preferred ?? types[0];
  const clinicName =
    directory.status === "ready" ? (id: string | null) => directory.data.clinics.find((c) => c.clinicId === id)?.name : () => undefined;

  const channelReady =
    channel === "WALK_IN" ||
    (channel === "PHONE" && /^\+[1-9]\d{7,14}$/.test(normalisePhone(callback, callbackCountry))) ||
    (channel === "REFERRAL" && facility.trim().length > 1);
  const ready = Boolean(patient && clinician && type && slot && channelReady);

  async function book(event: FormEvent) {
    event.preventDefault();
    if (!ready || !patient || !clinician || !type || !slot) return;
    setBusy(true);
    setFailure(null);
    try {
      const booked = await api<Appointment>("/appointments", {
        method: "POST",
        headers: { "Idempotency-Key": `desk-${patient.patientProfileId}-${slot.startAt}-${clinician.clinicianProfileId}` },
        json: {
          patientProfileId: patient.patientProfileId,
          clinicianProfileId: clinician.clinicianProfileId,
          appointmentTypeId: type.appointmentTypeId,
          startAt: slot.startAt,
          channel,
          ...(channel === "PHONE" ? { callbackPhone: normalisePhone(callback, callbackCountry) } : {}),
          ...(channel === "REFERRAL"
            ? { referringFacility: facility.trim(), referringClinicianName: referrer.trim(), referralNote: note.trim() }
            : {}),
        },
      });
      navigate(`/console/visits/${booked.appointmentId}`, { state: { said: `Booked ${booked.reference} for ${fullName(patient)}.` } });
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "The visit could not be booked")} Nothing was booked.`);
      setSlot(null);
      setFresh((n) => n + 1);
      setBusy(false);
    }
  }

  // A general practitioner books no one: their patients come through the
  // queue, and a specialist visit is booked by the front desk from the
  // referral (audit 2026-10-05).
  if (selfOnly && directory.status === "ready" && !clinicianBooks(directory.data.types, me?.clinicId)) {
    return (
      <div className="availability-page book-page">
        <header className="accounts-top">
          <div>
            <h1>Book for a patient</h1>
            <p>Your unit sees patients through the queue.</p>
          </div>
        </header>
        <Notice>
          Add the patient to today's queue from Queue. To send them to a specialist, give them a referral; the front desk books
          the visit with it.
        </Notice>
        <Link to="/console/queue" className="staff-primary accounts-new">
          Open the queue
        </Link>
      </div>
    );
  }

  return (
    <div className="availability-page book-page">
      <header className="accounts-top">
        <div>
          <h1>Book for a patient</h1>
          <p>Recorded against your account, with how the patient reached you.</p>
        </div>
      </header>

      <form className="availability-cols book-cols" onSubmit={book}>
        <section className="glass availability-card" aria-labelledby="book-who">
          <h2 id="book-who">Patient</h2>
          {patient ? (
            <div className="book-patient">
              <span className="account-avatar" aria-hidden="true">
                {initials(patient.givenName, patient.familyName) || "?"}
              </span>
              <span className="account-text">
                <span className="account-name">{fullName(patient)}</span>
                <span className="account-sub">
                  {[patient.patientNumber, phoneShown(patient.phoneE164), age(patient.dateOfBirth)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button
                type="button"
                className="square-button"
                aria-label="Choose another patient"
                onClick={() => {
                  setPatient(null);
                  setPatientId(null);
                }}
              >
                <Close size={15} />
              </button>
            </div>
          ) : (
            <>
              <label className="find-search">
                <Search size={17} />
                <input
                  type="text"
                  enterKeyHint="search"
                  aria-label="Find the patient"
                  placeholder="Name, mobile or patient number"
                  value={query}
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                />
                {searching && <LoadingIndicator size={18} label="Searching" />}
              </label>
              <ul className="book-results">
                {(results ?? []).slice(0, 5).map((p) => (
                  <li key={p.patientProfileId}>
                    <button
                      type="button"
                      className="suggest-item"
                      onClick={() => {
                        setPatient(p);
                        setPatientId(p.patientProfileId);
                        takeCallback(p.phoneE164);
                      }}
                    >
                      <span className="suggest-text">
                        <span className="suggest-main">{fullName(p)}</span>
                        <span className="suggest-hint">{[p.patientNumber, phoneShown(p.phoneE164)].join(" · ")}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="tonal-button book-new" onClick={() => setAdding(true)}>
                <Plus size={15} />
                New patient
              </button>
            </>
          )}

          <span className="settings-label">How they reached you</span>
          <div className="segmented" role="radiogroup" aria-label="How they reached you">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={channel === c.id}
                className={`segment${channel === c.id ? " segment-on" : ""}`}
                onClick={() => {
                  setChannel(c.id);
                  setSlot(null);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="availability-note">{CHANNELS.find((c) => c.id === channel)?.hint}</p>
          {channel === "PHONE" && (
            <PhoneField
              label="Number to call back on"
              value={callback}
              country={callbackCountry}
              onCountry={setCallbackCountry}
              onChange={setCallback}
            />
          )}
          {channel === "REFERRAL" && (
            <>
              <Field
                label="Referring facility"
                placeholder="Muea Integrated Health Centre"
                value={facility}
                maxLength={120}
                onChange={(e) => setFacility(e.target.value)}
              />
              <Field
                label="Referring clinician"
                hint="If named on the letter."
                value={referrer}
                maxLength={120}
                onChange={(e) => setReferrer(e.target.value)}
              />
              <textarea
                className="dialog-text"
                aria-label="Referral note"
                placeholder="What the letter says the patient is referred for"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </>
          )}

          <span className="settings-label">With</span>
          {selfOnly ? (
            clinician ? (
              <div className="book-patient">
                <span className="account-avatar" aria-hidden="true">
                  {initials(clinician.givenName, clinician.familyName)}
                </span>
                <span className="account-text">
                  <span className="account-name">{doctor(clinician)} (you)</span>
                  <span className="account-sub">{[clinician.specialty, clinicName(clinician.clinicId)].filter(Boolean).join(" · ")}</span>
                </span>
              </div>
            ) : null
          ) : (
            <SelectMenu
              label="Clinician"
              value={clinicianId}
              width={340}
              className="book-picker"
              placeholder="Choose a clinician"
              searchable
              icon={<Stethoscope size={15} />}
              onChange={(id) => {
                setClinicianId(id);
                setTypeId(null);
                setSlot(null);
              }}
              options={clinicians.map((c) => ({
                id: c.clinicianProfileId,
                label: doctor(c),
                hint: [c.specialty, clinicName(c.clinicId)].filter(Boolean).join(" · "),
                lead: (
                  <span className="picker-avatar" aria-hidden="true">
                    {initials(c.givenName, c.familyName)}
                  </span>
                ),
              }))}
            />
          )}
          {clinician && (
            <SelectMenu
              label="Visit type"
              value={type?.appointmentTypeId ?? null}
              width={340}
              className="book-picker"
              onChange={(id) => {
                setTypeId(id);
                setSlot(null);
              }}
              options={types.map((t) => ({ id: t.appointmentTypeId, label: t.name }))}
            />
          )}
          {clinician && !types.length && <p className="availability-note">Nothing this clinician's unit offers can be booked this way.</p>}
        </section>

        <section className="glass availability-card book-when" aria-labelledby="book-when">
          <h2 id="book-when">When</h2>
          {clinician && type ? (
            <WeekSlots
              key={`${clinician.clinicianProfileId}-${type.appointmentTypeId}-${channel === "WALK_IN"}`}
              clinicianId={clinician.clinicianProfileId}
              typeId={type.appointmentTypeId}
              slot={slot}
              onSlot={setSlot}
              fresh={fresh}
              onlyToday={channel === "WALK_IN"}
              onFailure={setFailure}
            />
          ) : (
            <p className="today-empty">Choose a clinician to see their free times.</p>
          )}
          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="book-dock">
            <span className="account-text">
              <span className="account-sub">{slot ? "Booking" : "No time chosen"}</span>
              <span className="account-name">
                {slot && clinician && type
                  ? `${clock.day(slot.startAt)}, ${clock.time(slot.startAt)} · ${doctor(clinician)}`
                  : patient
                    ? `For ${fullName(patient)}`
                    : "Choose the patient first"}
              </span>
            </span>
            <button type="submit" className="staff-primary" disabled={!ready || busy} aria-busy={busy || undefined}>
              <Calendar size={16} />
              {busy ? <LoadingIndicator size={20} label="Booking" /> : null}
              {busy ? "Booking" : "Book visit"}
            </button>
          </div>
        </section>
      </form>

      {adding && (
        <NewPatient
          start={query}
          onClose={() => setAdding(false)}
          onDone={(made) => {
            setAdding(false);
            setPatient(made);
            setPatientId(made.patientProfileId);
            takeCallback(made.phoneE164);
          }}
        />
      )}
      <p className="book-back">
        <Link to="/console/patients" className="link">
          Back to patients
        </Link>
      </p>
    </div>
  );
}
