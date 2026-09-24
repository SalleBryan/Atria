/**
 * The two-pane layout every Rev A sign-in screen shares: a blue brand pane on
 * the left, the form on a pale gradient on the right, each with soft blurred
 * orbs behind. Below 960px the brand pane folds into a header strip, as the
 * tablet and mobile frames do.
 */

import type { ComponentType, CSSProperties, ReactNode } from "react";

import { Bell, Calendar, Check, Pulse, Shield } from "./icons";

interface AuthLayoutProps {
  product: "PATIENT ACCOUNT" | "CLINIC CONSOLE";
  brand: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  /** The brand pane's width at desktop size: 620 for patients, narrower for staff. */
  paneWidth?: 520 | 600 | 620;
  boxWidth?: 480 | 520 | 560;
}

export function AuthLayout({ product, brand, footer, children, paneWidth = 620, boxWidth = 480 }: AuthLayoutProps) {
  return (
    <div className="auth" style={{ "--pane": `${paneWidth}px`, "--box": `${boxWidth}px` } as CSSProperties}>
      <aside className="brand-pane">
        <span className="orb orb-white" aria-hidden="true" />
        <span className="orb orb-blue" aria-hidden="true" />
        <div className="logo">
          <span className="logo-mark">
            <Pulse size={24} />
          </span>
          <span className="logo-text">
            <span className="logo-name">ATRIA</span>
            <span className="logo-product">{product}</span>
          </span>
        </div>
        <div className="brand-body">{brand}</div>
        <div className="brand-footer">{footer}</div>
      </aside>
      <main className="form-pane">
        <span className="orb orb-form-top" aria-hidden="true" />
        <span className="orb orb-form-bottom" aria-hidden="true" />
        <div className="auth-box">{children}</div>
      </main>
    </div>
  );
}

function Prop({ icon: IconComponent, title, text }: { icon: ComponentType<{ size?: number }>; title: string; text: string }) {
  return (
    <li className="prop">
      <span className="prop-icon">
        <IconComponent size={21} />
      </span>
      <span>
        <span className="prop-title">{title}</span>
        <span className="prop-text">{text}</span>
      </span>
    </li>
  );
}

/** The patient pitch, from "Desktop · Sign in / create". */
export function PatientBrand() {
  return (
    <>
      <h2 className="pitch">Care that keeps time with you.</h2>
      <p className="pitch-copy">
        Join today's queue or book ahead, and let Atria carry the calendar from there. One account, every device.
      </p>
      <ul className="props">
        <Prop icon={Calendar} title="Real availability" text="Slots you see are slots you can hold" />
        <Prop icon={Bell} title="Reminded before it matters" text="A text the day before, every time" />
        <Prop icon={Shield} title="Your record, your control" text="Shared only with the clinic you book" />
      </ul>
    </>
  );
}

/**
 * The console pitch, from "Desktop · Staff sign in". The design shows three
 * live figures here (booked today, slots open, clinicians on shift); nothing
 * about a clinic may be shown before anyone has signed in, so this pane keeps
 * the copy and drops the figures.
 */
export function StaffBrand() {
  return (
    <>
      <p className="eyebrow">Clinic console</p>
      <h2 className="pitch pitch-staff">The whole day, on one screen.</h2>
      <p className="pitch-copy">
        Every booking, cancellation and reminder your clinic sends, in the order it happens. Sign in to pick up
        today's schedule.
      </p>
    </>
  );
}

export interface Step {
  title: string;
  text: string;
  state: "done" | "current" | "upcoming";
}

/** The three steps of a staff member's first sign-in, from "Desktop · First sign-in". */
export function StepsBrand({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps">
      {steps.map((step, index) => (
        <li key={step.title} className={`step step-${step.state}`}>
          <span className="step-dot" aria-hidden="true">
            {step.state === "done" ? <Check size={15} /> : index + 1}
          </span>
          <span>
            <span className="step-title">{step.title}</span>
            <span className="step-text">{step.text}</span>
          </span>
          <span className="visually-hidden">
            {step.state === "done" ? "Done" : step.state === "current" ? "Current step" : "Still to come"}
          </span>
        </li>
      ))}
    </ol>
  );
}
