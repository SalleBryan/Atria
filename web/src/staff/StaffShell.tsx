/**
 * The staff console's frame, from the Rev A staff desktop screens ("Desktop ·
 * Day schedule", 65:2): the glass sidebar with the brand and the clinic's
 * name, the navigation, and the signed-in person with their role, beside the
 * screen itself. A layout route, like the patient shell, so the navigation
 * pill slides rather than jumps.
 *
 * The Rev A sidebar lists Patients, Clinicians and Messages; Messages is the
 * unit's message log (FR-MSG-05). An administrator also gets Staff accounts
 * (FR-ACC-04), and an administrator or unit manager the Audit log (FR-ADM-04).
 */

import { type ComponentType, type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";

import type { Me } from "../api/client";
import { useSession } from "../auth/session";
import { StaffAuthenticatorSetup } from "../pages/StaffAuthenticator";
import {
  Calendar,
  Chart,
  More as Grid,
  Clock,
  Inbox,
  ListOrdered,
  Mail,
  Pulse,
  Shield,
  SignOut,
  Sliders,
  Stethoscope,
  User,
  Users,
} from "../components/icons";
import { offeredAt } from "../patient/data";
import { runsQueue } from "./Queue";
import { SignOutMenu } from "../components/SignOutMenu";
import { MoreMenu } from "./MoreMenu";
import { Waiting } from "../components/Waiting";
import { initials } from "../patient/data";
import { ROLE_LABEL, roleOf, StaffDataProvider, useStaffData } from "./data";
import { revealSelected } from "../layout/side";
import { useScrollTopOnNavigate } from "../layout/scrollTop";

interface Destination {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  matches: (path: string) => boolean;
}

export function StaffShell() {
  const { state } = useSession();
  if (state.status === "loading") return <Waiting />;
  if (state.status !== "signed-in") return <Navigate to="/staff/sign-in" replace />;
  if (state.audience !== "staff") return <Navigate to="/home" replace />;
  // FR-ACC-11: nothing in the console opens until the administrator has one.
  if (state.me.secondFactorRequired) return <StaffAuthenticatorSetup me={state.me} />;
  return (
    <StaffDataProvider>
      <Shell me={state.me} />
    </StaffDataProvider>
  );
}

function Shell({ me }: { me: Me }) {
  const { pathname } = useLocation();
  useScrollTopOnNavigate(pathname);
  const { state } = useStaffData();
  const role = roleOf(me);

  const destinations: Destination[] = [
    // The administrator starts from the institution's overview (Admin · Overview, 211:2).
    ...(role === "TENANT_ADMIN"
      ? [{ to: "/console/overview", label: "Overview", icon: Grid, matches: (path: string) => path.startsWith("/console/overview") }]
      : []),
    {
      to: "/console",
      label: "Schedule",
      icon: Calendar,
      matches: (path) => path === "/console" || path.startsWith("/console/week") || path.startsWith("/console/visits"),
    },
    {
      to: "/console/patients",
      label: "Patients",
      icon: Users,
      matches: (path) => path.startsWith("/console/patients") || path.startsWith("/console/book"),
    },
  ];
  const types = state.status === "ready" ? state.data.types : [];
  // The outpatient department's staff run the queue (FR-BKG-13). For its
  // general practitioners the queue is the day's work, so it comes first.
  const queueUnit = role !== "TENANT_ADMIN" && runsQueue(types, me.clinicId);
  const gp = queueUnit && role === "CLINICIAN";
  if (queueUnit) {
    destinations.splice(gp ? 0 : destinations.length, 0, {
      to: "/console/queue",
      label: "Queue",
      icon: ListOrdered,
      matches: (path) => path.startsWith("/console/queue"),
    });
  }
  // Units that take procedure requests size and place them (FR-STF-15).
  if (
    (role === "CLINIC_MANAGER" || role === "CLINICIAN") &&
    types.some((t) => t.serviceLine === "PROCEDURE" && t.patientRequestable && offeredAt(t, me.clinicId))
  ) {
    destinations.push({
      to: "/console/requests",
      label: "Requests",
      icon: Inbox,
      matches: (path) => path.startsWith("/console/requests"),
    });
  }
  if (role === "RECEPTIONIST" || role === "CLINIC_MANAGER") {
    destinations.push({
      to: "/console/roster",
      label: "Roster",
      icon: Stethoscope,
      matches: (path) => path.startsWith("/console/roster"),
    });
  }
  if (role !== "TENANT_ADMIN") {
    destinations.push({
      to: "/console/availability",
      label: "Availability",
      icon: Clock,
      matches: (path) => path.startsWith("/console/availability"),
    });
  }
  // The unit's message log, failures first (FR-MSG-05); an administrator's
  // also holds the delivery figures (FR-MSG-06).
  if (role !== "CLINICIAN") {
    destinations.push({
      to: "/console/messages",
      label: "Messages",
      icon: Mail,
      matches: (path) => path.startsWith("/console/messages"),
    });
  }
  if (role === "TENANT_ADMIN") {
    destinations.push({
      to: "/console/staff",
      label: "Staff accounts",
      icon: User,
      matches: (path) => path.startsWith("/console/staff"),
    });
  }
  if (role === "TENANT_ADMIN") {
    destinations.push({
      to: "/console/settings",
      label: "Settings",
      icon: Sliders,
      matches: (path) => path.startsWith("/console/settings"),
    });
  }
  if (role === "TENANT_ADMIN" || role === "CLINIC_MANAGER") {
    destinations.push({
      to: "/console/reports",
      label: "Reports",
      icon: Chart,
      matches: (path) => path.startsWith("/console/reports"),
    });
    destinations.push({
      to: "/console/audit",
      label: "Audit log",
      icon: Shield,
      matches: (path) => path.startsWith("/console/audit"),
    });
  }
  destinations.push({
    to: "/console/account",
    label: "Account",
    icon: User,
    matches: (path) => path.startsWith("/console/account"),
  });
  // -1 when the page is not in the list (Account, or Queue before the unit's
  // types arrive): no pill then, rather than one on Schedule.
  const selected = destinations.findIndex((d) => d.matches(pathname));

  // A phone's bar holds four destinations and "More" (or "Sign out" when
  // four is all there is). The four stay put and "More" lights for what it
  // holds: swapping the open one into the bar moved Availability from under
  // the thumb (audit 2026-10-05).
  const BAR = 4;
  const fits = destinations.length <= BAR;
  const bar = fits ? destinations : destinations.slice(0, BAR);
  const rest = fits ? [] : destinations.slice(BAR);

  const [at, setAt] = useState(selected);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    pill.current?.getBoundingClientRect();
    setAt(selected);
    revealSelected(pill.current, selected);
  }, [selected]);

  // An administrator signs in to the overview; after that "/console" is the
  // schedule like everyone else's, so the Schedule link still goes there.
  if (role === "TENANT_ADMIN" && pathname === "/console" && !sawFirst("atria.overview")) {
    return <Navigate to="/console/overview" replace />;
  }
  // A general practitioner signs in to the queue the same way: their visits
  // come from it, so the schedule alone opened on an empty day (audit 2026-10-05).
  if (gp && pathname === "/console" && !sawFirst("atria.queue")) {
    return <Navigate to="/console/queue" replace />;
  }

  const clinic = state.status === "ready" ? state.data.clinics.find((c) => c.clinicId === me.clinicId)?.name : undefined;
  const name = [me.givenName, me.familyName].filter(Boolean).join(" ") || "Staff account";

  return (
    <div className={`patient-app staff-app${role === "TENANT_ADMIN" ? " admin-app" : ""}`}>
      <span className="orb patient-orb-a" aria-hidden="true" />
      <span className="orb patient-orb-b" aria-hidden="true" />
      <span className="orb patient-orb-c" aria-hidden="true" />

      <aside className="side-margin">
        <div className="side">
          <div className="side-brand">
            <span className="side-mark">
              <Pulse size={21} />
            </span>
            <span>
              <span className="side-name">ATRIA</span>
              <span className="side-product">{clinic ?? (role === "TENANT_ADMIN" ? "Admin console" : "Staff console")}</span>
            </span>
          </div>
          <div className="side-scroll">
            <p className="side-label">{role === "TENANT_ADMIN" ? "ADMINISTRATION" : "UNIT"}</p>
            <nav className="side-nav" aria-label="Console">
              <span
                ref={pill}
                className={`side-pill${at < 0 ? " side-pill-none" : ""}`}
                aria-hidden="true"
                style={{ "--at": Math.max(at, 0) } as CSSProperties}
              />
              {destinations.map(({ to, label, icon: IconComponent, matches }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/console"}
                  className={() => `side-item${matches(pathname) ? " active" : ""}`}
                  aria-current={matches(pathname) ? "page" : undefined}
                >
                  <IconComponent size={18} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
          <div className={`side-me${pathname === "/console/account" ? " side-me-active" : ""}`}>
            <Link to="/console/account" className="side-me-who" aria-label="Personal account" title="Personal account">
              <span className="side-avatar" aria-hidden="true">
                {initials(me.givenName, me.familyName) || "A"}
              </span>
              <span className="side-me-text">
                <span className="side-me-name">{name}</span>
                <span className="side-me-sub">{ROLE_LABEL[role]} · Staff</span>
              </span>
            </Link>
            <SignOutMenu className="icon-button" label="Sign out" align="end">
              <SignOut size={17} />
            </SignOutMenu>
          </div>
        </div>
      </aside>

      <main className="patient-main" id="main">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Console">
        {bar.map(({ to, label, icon: IconComponent, matches }) => (
          <NavLink
            key={to}
            to={to}
            className={() => `bottom-item${matches(pathname) ? " active" : ""}`}
            aria-current={matches(pathname) ? "page" : undefined}
          >
            <span className="bottom-indicator">
              <IconComponent size={20} />
            </span>
            <span className="bottom-label">{label}</span>
          </NavLink>
        ))}
        {rest.length ? (
          <MoreMenu items={rest} active={rest.some((d) => d.matches(pathname))} />
        ) : (
          <SignOutMenu className="bottom-item" align="end">
            <span className="bottom-indicator">
              <SignOut size={20} />
            </span>
            <span className="bottom-label">Sign out</span>
          </SignOutMenu>
        )}
      </nav>
    </div>
  );
}

function sawFirst(key: string): boolean {
  try {
    return Boolean(sessionStorage.getItem(key));
  } catch {
    return true;
  }
}
