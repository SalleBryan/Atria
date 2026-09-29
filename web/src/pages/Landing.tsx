/**
 * The front page, "Desktop · Landing" (113:2): the healthcare institution's
 * own page, which sends a patient to sign in or create an account and a
 * member of staff to the staff console.
 *
 * Every tenant will have its own site (Phase 3), so the institution's name
 * and place come from the tenant profile (src/tenant.ts), never a literal.
 * Where the frame shows what Phase 1 does not have, the nearest true thing
 * stands in: the frame's "Clinics" link would list the units publicly, which
 * needs a public API, so it is left out; "Find a clinician" asks the patient
 * to sign in first; and "Help" says where help is, the front desk. The cards
 * on the right are an illustration of the app, not anybody's appointment,
 * around a stock portrait (Unsplash License) in a morphing M3 shape; it
 * stands for no one at the hospital.
 *
 * Someone already signed in never sees this page: they go to their dashboard.
 */

import { type CSSProperties, useState } from "react";
import { Link } from "react-router-dom";

import doctorCoat from "../assets/doctor-coat.webp";
import pulseLine from "../assets/landing-pulse.svg";
import { ArrowUpRight, Close, Pin, Pulse, Shield } from "../components/icons";
import { TENANT } from "../tenant";
import { LandingMore, Rise } from "./LandingMore";

export function Landing() {
  const [help, setHelp] = useState(false);
  return (
    // The page scrolls, zoomed as a whole: the hero is its first screen and
    // the sections below say what Atria is and how to use it.
    <div className="landing-page">
      <div className="landing">
        <span className="orb landing-orb-a" aria-hidden="true" />
        <span className="orb landing-orb-b" aria-hidden="true" />
        <span className="orb landing-orb-c" aria-hidden="true" />

        <header className="landing-bar">
          <span className="landing-logo">
            <span className="logo-mark">
              <Pulse size={23} />
            </span>
            <span className="landing-wordmark">ATRIA</span>
          </span>
          <nav className="landing-links" aria-label="Atria">
            <span className="landing-link landing-link-on" aria-current="page">
              For patients
            </span>
            <a className="landing-link" href="#how">
              How it works
            </a>
            <Link className="landing-link" to="/sign-in">
              Find a clinician
            </Link>
            <button
              type="button"
              className="landing-link"
              aria-expanded={help}
              onClick={() => setHelp((open) => !open)}
            >
              Help
            </button>
          </nav>
          <span className="landing-push" />
          <Link className="landing-staff" to="/staff/sign-in">
            Staff sign-in
          </Link>
          <Link className="landing-sign-in" to="/sign-in">
            Sign in
          </Link>
          {help && (
            <div className="landing-help" role="dialog" aria-label="Help">
              <button
                type="button"
                className="icon-button"
                aria-label="Close help"
                onClick={() => setHelp(false)}
              >
                <Close size={15} />
              </button>
              <p className="landing-help-title">Need a hand?</p>
              <p>
                The front desk at {TENANT.name} can help with your account, your
                record and your visits. Forgotten your password? Choose "Forgot
                password?" when you sign in.
              </p>
            </div>
          )}
        </header>

        <main className="landing-main">
          <section className="landing-hero" aria-labelledby="landing-title">
            <p className="landing-eyebrow">
              WELCOME TO {TENANT.name.toUpperCase()}
            </p>
            <h1 id="landing-title">
              <Rise text="Care that keeps time with you." />
            </h1>
            <p className="landing-lede">
              Find a clinician, join today's queue or book ahead, and let Atria
              carry the calendar from there. The same account works on your
              laptop, tablet and phone.
            </p>
            <div className="landing-cta">
              <Link className="landing-create" to="/create-account">
                Create an account
              </Link>
              <Link className="landing-have" to="/sign-in">
                <ArrowUpRight size={19} />I already have an account
              </Link>
            </div>
            <ul className="landing-trust">
              <li>
                <span className="landing-trust-icon" aria-hidden="true">
                  <Shield size={13} />
                </span>
                Records shared only with your healthcare institution
              </li>
              <li>
                <span className="landing-trust-icon" aria-hidden="true">
                  <Pin size={13} />
                </span>
                {TENANT.name} · {TENANT.place}
              </li>
            </ul>
          </section>

          <div className="landing-stage" aria-hidden="true">
            <img
              className="landing-pulse"
              src={pulseLine}
              width="740"
              height="78"
              alt=""
            />
            <span className="hero-ring" />
            <img
              className="hero-portrait"
              src={doctorCoat}
              width="660"
              height="800"
              alt=""
            />
            <div
              className="landing-card landing-card-visit"
              style={{ "--i": 0 } as CSSProperties}
            >
              <span className="landing-card-who">
                <span className="landing-avatar">EM</span>
                <span>
                  <span className="landing-card-name">Dr Esther Mbarga</span>
                  <span className="landing-card-sub">
                    Paediatrics · Paediatrics Unit
                  </span>
                </span>
              </span>
              <span className="landing-card-label">NEXT VISIT</span>
              <span className="landing-time">10:00</span>
              <span className="landing-card-sub landing-card-when">
                Wednesday · Paediatrics Unit
              </span>
              <span className="landing-chips">
                <span className="landing-chip landing-chip-on">Confirmed</span>
                <span className="landing-chip">Reminder 24h ahead</span>
              </span>
            </div>
            <div
              className="landing-card landing-card-reminder"
              style={{ "--i": 1 } as CSSProperties}
            >
              <span className="landing-card-label">REMINDER</span>
              <span className="landing-big">24h ahead</span>
              <span className="landing-card-sub landing-card-when">
                SMS and email on Tuesday, 10:00
              </span>
            </div>
            <div
              className="landing-card landing-card-week"
              style={{ "--i": 2 } as CSSProperties}
            >
              <span className="landing-card-label">THIS WEEK</span>
              <span className="landing-big">4 openings</span>
              <span className="landing-chips">
                <span className="landing-chip">09:30</span>
                <span className="landing-chip landing-chip-on">10:15</span>
                <span className="landing-chip">14:00</span>
              </span>
            </div>
          </div>

          <a className="landing-scroll" href="#about">
            <span className="landing-scroll-pill" aria-hidden="true">
              <span />
            </span>
            What Atria is
          </a>
        </main>
      </div>
      <LandingMore />
    </div>
  );
}
