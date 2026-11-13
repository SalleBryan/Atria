/**
 * Setting up a unit (business lane B4): what a new unit still needs before it
 * can take bookings, each step read from what the console already knows, with
 * the screen that does it one click away. Nothing is stored: a step is done
 * when the data says so, so the list cannot drift from the truth. The staff and
 * patient importers are the existing ones.
 */

import { type CSSProperties, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { api, apiAll } from "../api/client";
import { useSession } from "../auth/session";
import { Notice } from "../components/controls";
import { LoadingPane } from "../components/LoadingPane";
import { SelectMenu } from "../components/Pickers";
import { type AppointmentType, type Clinic, type Clinician, offeredAt } from "../patient/data";
import { roleOf } from "./data";

interface Step {
  id: string;
  title: string;
  detail: string;
  done: boolean | null;
  to: string;
  action: string;
}

export function Onboarding() {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : undefined;
  const [unit, setUnit] = useState("");
  // null while asking, so an unanswered step is not shown as missing.
  const [patients, setPatients] = useState<number | null>(null);
  // Read afresh each time the screen opens: the console's own copy is loaded once,
  // so it would not show a unit added a moment ago, which is when this list is wanted.
  const [found, setFound] = useState<{ clinics: Clinic[]; clinicians: Clinician[]; types: AppointmentType[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      apiAll<{ clinics: Clinic[]; nextCursor?: string | null }>("/clinics", "clinics"),
      apiAll<{ clinicians: Clinician[]; nextCursor?: string | null }>("/clinicians", "clinicians"),
      apiAll<{ appointmentTypes: AppointmentType[]; nextCursor?: string | null }>("/appointment-types", "appointmentTypes"),
    ])
      .then(([c, p, t]) => live && setFound({ clinics: c.clinics, clinicians: p.clinicians, types: t.appointmentTypes }))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    api<{ results: unknown[] }>("/patients")
      .then((page) => live && setPatients(page.results.length))
      .catch(() => live && setPatients(null));
    return () => {
      live = false;
    };
  }, []);

  if (state.status !== "signed-in") return null;
  if (me && roleOf(me) !== "TENANT_ADMIN") return <Navigate to="/console" replace />;
  if (failed) return <Notice tone="error">The units could not be loaded.</Notice>;
  if (!found) return <LoadingPane label="Loading the units" />;

  const { clinics, clinicians, types } = found;
  const chosen = clinics.find((c) => c.clinicId === unit) ?? clinics[0];
  if (!chosen) {
    return (
      <div className="accounts-page">
        <header className="accounts-top">
          <div>
            <h1>Set up a unit</h1>
            <p>No unit exists yet. Add the first one in Hospital settings.</p>
          </div>
          <Link className="outline-button" to="/console/settings">
            Hospital settings
          </Link>
        </header>
      </div>
    );
  }

  const offered = types.filter((t) => offeredAt(t, chosen.clinicId));
  const unpriced = offered.filter((t) => t.feeAmountMinor == null);
  const staff = clinicians.filter((c) => c.clinicId === chosen.clinicId);
  const hours = chosen.openingHours && Object.keys(chosen.openingHours).length > 0;

  const steps: Step[] = [
    {
      id: "details",
      title: "Unit details",
      detail: "Address, phone and opening hours, as patients read them.",
      done: Boolean(chosen.address && chosen.phone && hours),
      to: "/console/settings",
      action: "Open Hospital settings",
    },
    {
      id: "types",
      title: "Visit types",
      detail: offered.length ? `${offered.length} offered at this unit.` : "Nothing can be booked here until a visit type is offered.",
      done: offered.length > 0,
      to: "/console/settings",
      action: "Open Visit types",
    },
    {
      id: "fees",
      title: "Fees shown before booking",
      detail: !offered.length
        ? "Offer a visit type first."
        : unpriced.length
          ? `${unpriced.length} of ${offered.length} offered visit types have no fee band.`
          : "Every offered visit type shows its fee.",
      done: offered.length > 0 && unpriced.length === 0,
      to: "/console/settings",
      action: "Open Fees",
    },
    {
      id: "staff",
      title: "Clinicians",
      detail: staff.length
        ? `${staff.length} bookable at this unit.`
        : "Create the unit's accounts one by one, or import a staff workbook.",
      done: staff.length > 0,
      to: "/console/staff",
      action: "Open Staff accounts",
    },
    {
      id: "patients",
      title: "Patients",
      detail: "The hospital's register. Import a patient workbook, or let patients create their own accounts.",
      done: patients == null ? null : patients > 0,
      to: "/console/patients",
      action: "Open Patients",
    },
  ];
  const finished = steps.filter((s) => s.done).length;

  return (
    <div className="accounts-page">
      <header className="accounts-top">
        <div>
          <h1>Set up a unit</h1>
          <p>
            {finished} of {steps.length} steps done for {chosen.name}. Each is read from what is on record now.
          </p>
        </div>
        <SelectMenu
          label="Unit"
          value={chosen.clinicId}
          width={260}
          options={clinics.map((c) => ({ id: c.clinicId, label: c.name }))}
          onChange={setUnit}
        />
      </header>

      <section className="glass accounts-card" aria-label="Steps">
        <ul className="accounts-rows">
          {steps.map((step, index) => (
            <li key={step.id} className="onboarding-row" style={{ "--i": index } as CSSProperties}>
              <span>
                <strong>{step.title}</strong>
                <br />
                <span className="availability-note">{step.detail}</span>
              </span>
              <span className={`chip ${step.done ? "chip-confirmed" : "chip-booked"}`}>
                {step.done == null ? "Checking" : step.done ? "Done" : "To do"}
              </span>
              <Link className="outline-button" to={step.to}>
                {step.action}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
