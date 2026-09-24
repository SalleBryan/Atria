/**
 * The staff console's frame, from the Rev A staff desktop screens ("Desktop ·
 * Day schedule", 65:2): the glass sidebar with the brand and the clinic's
 * name, the navigation, and the signed-in person with their role, beside the
 * screen itself. A layout route, like the patient shell, so the navigation
 * pill slides rather than jumps.
 *
 * The Rev A sidebar also lists Patients, Clinicians and Messages. The patient
 * register, the staff directory and the message log have no Phase 1 endpoint
 * (they are Phase 2), so those items are left out rather than leading to
 * empty screens. An administrator also gets Staff accounts (FR-ACC-04).
 */

import { type ComponentType, type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";

import type { Me } from "../api/client";
import { useSession } from "../auth/session";
import { Calendar, Pulse, SignOut, User } from "../components/icons";
import { Waiting } from "../components/Waiting";
import { initials } from "../patient/data";
import { ROLE_LABEL, roleOf, StaffDataProvider, useStaffData } from "./data";

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
  return (
    <StaffDataProvider>
      <Shell me={state.me} />
    </StaffDataProvider>
  );
}

function Shell({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const { signOut } = useSession();
  const { state } = useStaffData();
  const role = roleOf(me);

  const destinations: Destination[] = [
    {
      to: "/console",
      label: "Schedule",
      icon: Calendar,
      matches: (path) => path === "/console" || path.startsWith("/console/week") || path.startsWith("/console/visits"),
    },
  ];
  if (role === "TENANT_ADMIN") {
    destinations.push({
      to: "/console/staff",
      label: "Staff accounts",
      icon: User,
      matches: (path) => path.startsWith("/console/staff"),
    });
  }
  const selected = Math.max(
    0,
    destinations.findIndex((d) => d.matches(pathname)),
  );

  const [at, setAt] = useState(selected);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    pill.current?.getBoundingClientRect();
    setAt(selected);
  }, [selected]);

  const clinic =
    state.status === "ready" ? state.data.clinics.find((c) => c.clinicId === me.clinicId)?.name : undefined;
  const name = [me.givenName, me.familyName].filter(Boolean).join(" ") || "Staff account";

  return (
    <div className="patient-app staff-app">
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
              <span className="side-product">{clinic ?? (role === "TENANT_ADMIN" ? "Administration" : "Clinic console")}</span>
            </span>
          </div>
          <p className="side-label">{role === "TENANT_ADMIN" ? "TENANT" : "CLINIC"}</p>
          <nav className="side-nav" aria-label="Console">
            <span ref={pill} className="side-pill" aria-hidden="true" style={{ "--at": at } as CSSProperties} />
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
          <div className="side-spacer" />
          <div className="side-me">
            <span className="side-avatar" aria-hidden="true">
              {initials(me.givenName, me.familyName) || "A"}
            </span>
            <span className="side-me-text">
              <span className="side-me-name">{name}</span>
              <span className="side-me-sub">{ROLE_LABEL[role]} · Staff</span>
            </span>
            <button type="button" className="icon-button" onClick={() => void signOut()} aria-label="Sign out">
              <SignOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="patient-main" id="main">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Console">
        {destinations.map(({ to, label, icon: IconComponent, matches }) => (
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
        <button type="button" className="bottom-item" onClick={() => void signOut()}>
          <span className="bottom-indicator">
            <SignOut size={20} />
          </span>
          <span className="bottom-label">Sign out</span>
        </button>
      </nav>
    </div>
  );
}
