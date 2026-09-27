/**
 * "Available today" on Mobile · Home (28:2): the clinicians with an opening
 * left today, soonest first, narrowed by specialty.
 *
 * Each clinician's next free start comes from the same endpoint Find care
 * uses (FR-DIR-02), for the first specialist type, so an opening shown here
 * is one that can be booked. Only the phone layout shows this, and only it
 * asks for the openings.
 */

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { byPopularity, ChipRow, FilterMenu } from "../components/FilterMenu";
import { Clock } from "../components/icons";
import { type Clinician, clock, clinicianName, initials, SENIORITY, usePatientData } from "./data";

const GRADIENTS = [
  ["#6f9bf5", "#3564d6"],
  ["#3fa9c9", "#1e7fa8"],
  ["#7c7bf0", "#4b49ce"],
  ["#4ca6ec", "#1f6fc4"],
] as const;

export function AvailableToday() {
  const { state } = usePatientData();
  const data = state.status === "ready" ? state.data : undefined;
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [next, setNext] = useState<Record<string, string | null>>({});

  const type = data?.types.find((t) => t.serviceLine === "SPECIALIST" && t.durationUnits);
  const today = clock.isoDate(new Date());

  useEffect(() => {
    if (!data || !type) return;
    let live = true;
    for (const clinician of data.clinicians) {
      api<{ slots: { startAt: string }[] }>(
        `/clinicians/${encodeURIComponent(clinician.clinicianProfileId)}/slots?date=${today}&typeId=${encodeURIComponent(type.appointmentTypeId)}`,
      )
        .then((found) => live && setNext((current) => ({ ...current, [clinician.clinicianProfileId]: found.slots[0]?.startAt ?? null })))
        .catch(() => live && setNext((current) => ({ ...current, [clinician.clinicianProfileId]: null })));
    }
    return () => {
      live = false;
    };
  }, [data, type, today]);

  const specialties = useMemo(() => byPopularity(data?.clinicians ?? [], (c) => c.specialty), [data]);
  const [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const open = (data?.clinicians ?? [])
    .filter((c) => next[c.clinicianProfileId])
    .filter((c) => !specialty || c.specialty === specialty)
    .sort((a, b) => String(next[a.clinicianProfileId]).localeCompare(String(next[b.clinicianProfileId])));
  const waiting = data ? data.clinicians.some((c) => !(c.clinicianProfileId in next)) : true;

  return (
    <section className="today" aria-labelledby="today-title">
      <ChipRow
        className="today-chips"
        label="Specialty"
        options={specialties}
        value={specialty}
        onChange={setSpecialty}
        onMore={() => setMenuOpen(true)}
        moreRef={more}
      />
      <FilterMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={more}
        title="Available today"
        sections={[{ id: "specialty", label: "Specialty", options: specialties, value: specialty, onChange: setSpecialty }]}
        results={open.length === 1 ? "Show 1 clinician" : `Show ${open.length} clinicians`}
        onClear={() => setSpecialty(null)}
      />
      <div className="today-head">
        <h2 id="today-title">Available today</h2>
        <Link className="link" to="/find-care">
          {waiting ? "Checking" : `${open.length} open`}
        </Link>
      </div>
      {!waiting && open.length === 0 && <p className="today-empty">No openings left today. Find care shows the days ahead.</p>}
      <ul className="today-list">
        {open.map((clinician: Clinician, index) => {
          const [from, to] = GRADIENTS[index % GRADIENTS.length] as readonly [string, string];
          const clinic = data?.clinics.find((c) => c.clinicId === clinician.clinicId);
          return (
            <li key={clinician.clinicianProfileId} style={{ "--i": index } as CSSProperties}>
              <Link className="today-card" to={`/find-care?clinician=${clinician.clinicianProfileId}`}>
                <span className="today-avatar" style={{ background: `linear-gradient(140deg, ${from}, ${to})` }} aria-hidden="true">
                  {initials(clinician.givenName, clinician.familyName)}
                </span>
                <span className="today-text">
                  <span className="today-name">{clinicianName(clinician)}</span>
                  <span className="today-sub">{[clinician.specialty, clinic?.name].filter(Boolean).join(" · ")}</span>
                  <span className="today-next">
                    <Clock size={12} />
                    Next {clock.time(String(next[clinician.clinicianProfileId]))}
                  </span>
                </span>
                <span className="today-band">{SENIORITY[clinician.seniorityBand]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
