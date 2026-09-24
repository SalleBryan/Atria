/**
 * The patient app's frame, from the Rev A patient desktop screens: a glass
 * sidebar with the brand, the navigation and the signed-in person, beside the
 * screen itself. It is a layout route, so it stays mounted while the screens
 * change and the selected navigation pill slides from one item to the next.
 *
 * Below 960px the sidebar gives way to a Material 3 navigation bar along the
 * bottom, as the mobile frames have it.
 *
 * The Rev A sidebar also lists Notifications. The patient's messages have no
 * endpoint until Phase 2 (FR-MSG-05), so the item is left out rather than
 * leading to an empty screen.
 */

import { type ComponentType, type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";

import type { Me } from "../api/client";
import { useSession } from "../auth/session";
import { Calendar, Home, Pulse, Search, SignOut, User } from "../components/icons";
import { Waiting } from "../components/Waiting";
import { initials, PatientDataProvider, upcoming, usePatientData } from "./data";

interface Destination {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  count?: number;
}

export function PatientShell() {
  const { state } = useSession();
  if (state.status === "loading") return <Waiting />;
  if (state.status !== "signed-in") return <Navigate to="/sign-in" replace />;
  if (state.audience === "staff" || !state.me.patientProfileId) return <Navigate to="/console" replace />;
  return (
    <PatientDataProvider>
      <Shell me={state.me} />
    </PatientDataProvider>
  );
}

function Shell({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const { signOut } = useSession();
  const { state } = usePatientData();
  const ahead = state.status === "ready" ? upcoming(state.data.appointments).length : undefined;

  const destinations: Destination[] = [
    { to: "/home", label: "Home", icon: Home },
    { to: "/find-care", label: "Find care", icon: Search },
    { to: "/visits", label: "My visits", icon: Calendar, count: ahead || undefined },
    { to: "/account", label: "Account", icon: User },
  ];
  const selected = Math.max(
    0,
    destinations.findIndex((d) => pathname === d.to || pathname.startsWith(`${d.to}/`)),
  );

  // The pill springs to the new item: the old position is settled first, then
  // the new one set before paint (as the sign-in segmented control does).
  const [at, setAt] = useState(selected);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    pill.current?.getBoundingClientRect();
    setAt(selected);
  }, [selected]);

  const name = [me.givenName, me.familyName].filter(Boolean).join(" ") || "Your account";

  return (
    <div className="patient-app">
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
              <span className="side-product">Patient</span>
            </span>
          </div>
          <p className="side-label">YOUR CARE</p>
          <nav className="side-nav" aria-label="Patient">
            <span
              ref={pill}
              className="side-pill"
              aria-hidden="true"
              style={{ "--at": at } as CSSProperties}
            />
            {destinations.map(({ to, label, icon: IconComponent, count }) => (
              <NavLink key={to} to={to} className="side-item">
                <IconComponent size={18} />
                <span>{label}</span>
                {count ? (
                  <span className="side-pip" aria-label={`${count} upcoming`}>
                    {count}
                  </span>
                ) : null}
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
              <span className="side-me-sub">Patient</span>
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

      <nav className="bottom-nav" aria-label="Patient">
        {destinations.map(({ to, label, icon: IconComponent, count }) => (
          <NavLink key={to} to={to} className="bottom-item">
            <span className="bottom-indicator">
              <IconComponent size={20} />
              {count ? <span className="bottom-badge">{count}</span> : null}
            </span>
            <span className="bottom-label">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
