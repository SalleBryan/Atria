/**
 * The unit's clinicians on a day: who is on shift, and how full each day is (FR-STF-08).
 *
 * For the front desk and the unit manager. Each clinician is a row with a
 * status chip, their hours, any time off, and a load bar filling with the
 * minutes booked against the minutes they work. Today by default; the date
 * picker looks ahead. Built from Staff accounts' rows and the platform's
 * pickers.
 */

import { type CSSProperties, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { api } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { DatePicker } from "../components/Pickers";
import { clock, initials } from "../patient/data";
import { doctor, roleOf, useStaffData } from "./data";
import { sentence } from "./labels";

interface RosterRow {
  clinicianProfileId: string;
  givenName: string | null;
  familyName: string | null;
  specialty: string | null;
  status: "OFF" | "LEAVE" | "UNAVAILABLE" | "LATER" | "ON_SHIFT" | "FINISHED" | "SCHEDULED";
  startsAt: string | null;
  endsAt: string | null;
  timeOff: { kind: string; startTime: string | null; endTime: string | null }[];
  visits: number;
  bookedMinutes: number;
  workingMinutes: number;
  load: number | null;
}

interface Roster {
  clinicId: string;
  date: string;
  clinicians: RosterRow[];
  onShift: number;
}

export const ROSTER_STATUS: Record<RosterRow["status"], { label: string; tone: string }> = {
  ON_SHIFT: { label: "On shift", tone: "confirmed" },
  LATER: { label: "Starts later", tone: "booked" },
  SCHEDULED: { label: "Working", tone: "booked" },
  UNAVAILABLE: { label: "Unavailable", tone: "cancelled" },
  FINISHED: { label: "Finished", tone: "neutral" },
  LEAVE: { label: "On leave", tone: "awaiting" },
  OFF: { label: "Day off", tone: "neutral" },
};

const OFF_KIND: Record<string, string> = { BLOCK: "Blocked", LEAVE: "Leave", UNAVAILABLE: "Unavailable" };

export function RosterPage() {
  const { state } = useSession();
  const { state: directory } = useStaffData();
  const me = state.status === "signed-in" ? state.me : undefined;
  const role = me ? roleOf(me) : "RECEPTIONIST";
  const today = clock.isoDate(new Date());
  const [date, setDate] = useState(today);
  const [found, setFound] = useState<Roster | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const clinicId = me?.clinicId ?? null;

  useEffect(() => {
    if (!clinicId) return;
    let live = true;
    setFound(null);
    api<Roster>(`/clinics/${encodeURIComponent(clinicId)}/roster?date=${date}`)
      .then((data) => {
        if (!live) return;
        setFound(data);
        setFailure(null);
      })
      .catch((error: unknown) => live && setFailure(error instanceof Error ? sentence(error.message) : "The roster could not be loaded."));
    return () => {
      live = false;
    };
  }, [clinicId, date]);

  if (state.status !== "signed-in") return null;
  if (role === "CLINICIAN" || role === "TENANT_ADMIN" || !clinicId) return <Navigate to="/console" replace />;

  const unit = directory.status === "ready" ? directory.data.clinics.find((c) => c.clinicId === clinicId)?.name : undefined;
  const rows = found?.clinicians ?? [];

  return (
    <div className="accounts-page roster-page">
      <header className="accounts-top">
        <div>
          <h1>Roster</h1>
          <p>
            {unit ?? "Your unit"} · {date === today ? "today" : clock.long(`${date}T12:00:00Z`)}
            {found && date === today ? `, ${found.onShift} on shift now` : ""}
          </p>
        </div>
        <div className="availability-who">
          <span>Day</span>
          <DatePicker label="Day" value={date} min={today} onChange={setDate} />
        </div>
      </header>

      <section className="glass accounts-card" aria-label="Clinicians" aria-busy={!found || undefined}>
        {failure && <Notice tone="error">{failure}</Notice>}
        <div className="accounts-head roster-head" aria-hidden="true">
          <span>CLINICIAN</span>
          <span>STATUS</span>
          <span>HOURS</span>
          <span>BOOKED</span>
        </div>
        <ul className="accounts-rows">
          {!found ? (
            <li>
              <LoadingIndicator size={28} label="Loading the roster" />
            </li>
          ) : rows.length ? (
            rows.map((row, index) => {
              const status = ROSTER_STATUS[row.status];
              const load = Math.min(1, row.load ?? 0);
              return (
                <li
                  key={row.clinicianProfileId}
                  className={`account-row roster-row${row.status === "OFF" || row.status === "LEAVE" ? " account-row-off" : ""}`}
                  style={{ "--i": index } as CSSProperties}
                >
                  <span className="account-who">
                    <span className="account-avatar" aria-hidden="true">
                      {initials(row.givenName, row.familyName) || "DR"}
                    </span>
                    <span className="account-text">
                      <span className="account-name">{doctor(row)}</span>
                      <span className="account-sub">{row.specialty ?? "Clinician"}</span>
                    </span>
                  </span>
                  <span>
                    <span className={`chip chip-${status.tone}`}>{status.label}</span>
                  </span>
                  <span className="account-role">
                    <span>{row.startsAt ? `${row.startsAt} to ${row.endsAt}` : "Not working"}</span>
                    <span>
                      {row.timeOff.length
                        ? row.timeOff
                            .map((t) => `${OFF_KIND[t.kind] ?? t.kind}${t.startTime ? ` ${t.startTime} to ${t.endTime}` : ", all day"}`)
                            .join("; ")
                        : "No time off"}
                    </span>
                  </span>
                  <span className="roster-load">
                    <span className="roster-load-text">
                      {row.visits} {row.visits === 1 ? "visit" : "visits"}
                      {row.load !== null && <span> · {Math.round((row.load ?? 0) * 100)}%</span>}
                    </span>
                    <span
                      className="roster-bar"
                      role="meter"
                      aria-label={`${doctor(row)}'s day booked`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(load * 100)}
                    >
                      <span
                        className={`roster-fill${load >= 0.85 ? " roster-full" : ""}`}
                        style={{ width: `${Math.round(load * 100)}%` }}
                      />
                    </span>
                  </span>
                </li>
              );
            })
          ) : (
            <li className="today-empty">No clinicians in this unit.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
