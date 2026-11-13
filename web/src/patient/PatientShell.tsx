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

import { CompleteProfile } from "../pages/CompleteProfile";
import { RestoreAccount } from "../pages/RestoreAccount";
import { type ComponentType, type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";

import type { Me } from "../api/client";
import { useSession } from "../auth/session";
import { Calendar, Home, Pulse, Search, SignOut, User } from "../components/icons";
import { Waiting } from "../components/Waiting";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";
import { initials, PatientDataProvider, upcoming, usePatientData } from "./data";
import { revealSelected } from "../layout/side";
import { useScrollTopOnNavigate } from "../layout/scrollTop";

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
  // A deleted account signed in again within its 30 days is offered back first.
  if (state.me.deletion) return <RestoreAccount me={state.me} />;
  // A record without a mobile, a date of birth or agreed terms is finished first.
  if (state.me.missing?.length) return <CompleteProfile me={state.me} />;
  return (
    <PatientDataProvider>
      <Shell me={state.me} />
    </PatientDataProvider>
  );
}

function Shell({ me }: { me: Me }) {
  const { pathname } = useLocation();
  useScrollTopOnNavigate(pathname);
  const { signOut } = useSession();
  const { state } = usePatientData();
  const ahead = state.status === "ready" ? upcoming(state.data.appointments).length : undefined;

  const destinations: Destination[] = [
    { to: "/home", label: "Home", icon: Home },
    { to: "/find-care", label: "Find care", icon: Search },
    { to: "/visits", label: "My visits", icon: Calendar, count: ahead || undefined },
    { to: "/account", label: "Account", icon: User },
  ];
  // -1 when the page is not in the list (Account, or Queue before the unit's
  // types arrive): no pill then, rather than one on Schedule.
  const selected = destinations.findIndex((d) => pathname === d.to || pathname.startsWith(`${d.to}/`));

  // The pill springs to the new item: the old position is settled first, then
  // the new one set before paint (as the sign-in segmented control does).
  const [at, setAt] = useState(selected);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    pill.current?.getBoundingClientRect();
    setAt(selected);
    revealSelected(pill.current, selected);
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
          <div className="side-scroll">
            <p className="side-label">YOUR CARE</p>
            <nav className="side-nav" aria-label="Patient">
              <span
                ref={pill}
                className={`side-pill${at < 0 ? " side-pill-none" : ""}`}
                aria-hidden="true"
                style={{ "--at": Math.max(at, 0) } as CSSProperties}
              />
              {destinations.map(({ to, label, icon: IconComponent, count }) => (
                <NavLink key={to} to={to} className="side-item">
                  {/* Material 3's large badge, pinned to the icon as on a navigation rail. */}
                  <span className="side-icon">
                    <IconComponent size={18} />
                    {count ? (
                      <span key={count} className="m3-badge" aria-label={`${count} upcoming`}>
                        {count > 99 ? "99+" : count}
                      </span>
                    ) : null}
                  </span>
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="side-me">
            <span className="side-avatar" aria-hidden="true">
              {initials(me.givenName, me.familyName) || "A"}
            </span>
            <span className="side-me-text">
              <span className="side-me-name">{name}</span>
              <span className="side-me-sub">Patient</span>
            </span>
            <LanguageSwitcher />
            <button type="button" className="icon-button" onClick={() => void signOut()} aria-label="Sign out">
              <SignOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <LanguageSwitcher className="icon-button lang-float" />
      <main className="patient-main" id="main">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Patient">
        {destinations.map(({ to, label, icon: IconComponent, count }) => (
          <NavLink key={to} to={to} className="bottom-item">
            <span className="bottom-indicator">
              <IconComponent size={20} />
              {count ? (
                <span key={count} className="m3-badge" aria-hidden="true">
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </span>
            <span className="bottom-label">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
