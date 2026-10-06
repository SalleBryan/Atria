/**
 * What happened to a visit, step by step, from the API's record of it
 * (GET /appointments/{id} history, APPOINTMENT_EVENT).
 *
 * The timeline used to be read back from the state a visit is in now, so a
 * move or a rebooking never showed, "New time needed" vanished once the
 * patient chose again, and a cancellation had no time (audit 2026-10-05).
 * Each step now says what happened, when, and who did it: to a patient, "you"
 * or the role; to staff, the role and the reason given.
 *
 * Until the history arrives, and for a visit recorded before events were
 * kept, the steps the screen worked out before are shown instead, so the
 * card is never empty. Whatever is still to come (the reminder) follows.
 */

import { type ReactNode, useEffect, useState } from "react";

import { api } from "../api/client";
import { clock } from "../patient/data";
import { Alert, Bell, Calendar, CheckMark, Clipboard, Close, Pin, Repeat, Stethoscope, User } from "./icons";

export interface VisitEvent {
  appointmentEventId: string;
  kind: string;
  toState: string | null;
  actorRole: string | null;
  byYou: boolean;
  occurredAt: string;
  previousStartAt: string | null;
  rescheduledBy: string | null;
  reason: string | null;
}

type Audience = "patient" | "staff";

const ROLE: Record<string, string> = {
  RECEPTIONIST: "a receptionist",
  CLINICIAN: "the clinician",
  CLINIC_MANAGER: "the unit manager",
  TENANT_ADMIN: "an administrator",
};

function who(event: VisitEvent, audience: Audience): string {
  if (event.byYou) return "by you";
  if (event.actorRole && ROLE[event.actorRole]) return `by ${ROLE[event.actorRole]}`;
  return audience === "patient" ? "" : "by the patient";
}

/** One step, in the words and colours of the timeline the screens already use. */
function step(event: VisitEvent, audience: Audience): { title: string; tone: string; icon: ReactNode } {
  const by = who(event, audience);
  const with_ = (title: string) => (by ? `${title} ${by}` : title);
  switch (event.kind) {
    case "BOOKED":
      return { title: with_("Booked"), tone: "dot-done", icon: <CheckMark size={11} /> };
    case "REQUESTED":
      return { title: with_("Requested"), tone: "dot-done", icon: <Clipboard size={11} /> };
    case "PLACED":
      return { title: with_("Time set"), tone: "dot-blue-tint", icon: <Calendar size={11} /> };
    case "CONFIRMED":
      return { title: with_("Confirmed"), tone: "dot-blue-tint", icon: <CheckMark size={11} /> };
    case "RESCHEDULED":
      return {
        title: event.previousStartAt
          ? with_(`Moved from ${clock.day(event.previousStartAt)}, ${clock.time(event.previousStartAt)}`)
          : with_("Moved"),
        tone: "dot-blue-tint",
        icon: <Repeat size={11} />,
      };
    case "DISRUPTED":
      return { title: "New time needed", tone: "dot-amber-tint", icon: <Alert size={11} /> };
    case "CANCELLED":
      return {
        title: event.toState === "CLINIC_CANCELLED" ? "Cancelled by the hospital" : with_("Cancelled"),
        tone: "dot-red",
        icon: <Close size={11} />,
      };
    case "DECLINED":
      return { title: "Request declined", tone: "dot-red", icon: <Close size={11} /> };
    case "ARRIVED":
      return { title: "Arrived", tone: "dot-blue-tint", icon: <Pin size={11} /> };
    case "CONSULTATION_STARTED":
      return { title: "Consultation started", tone: "dot-blue-tint", icon: <Stethoscope size={11} /> };
    case "COMPLETED":
      return { title: "Visit completed", tone: "dot-done", icon: <CheckMark size={11} /> };
    case "NO_SHOW":
      return { title: "Recorded as not attended", tone: "dot-red", icon: <User size={11} /> };
    default:
      return { title: event.kind.charAt(0) + event.kind.slice(1).toLowerCase().replace(/_/g, " "), tone: "dot-blue-tint", icon: <Bell size={11} /> };
  }
}

export function VisitHistory({
  appointmentId,
  audience,
  fallback,
  children,
  refresh,
  className = "timeline",
}: {
  appointmentId: string;
  audience: Audience;
  /** The steps worked out from the visit's state, while the history loads. */
  fallback: ReactNode;
  /** What is still to come, after the history: the reminder. */
  children?: ReactNode;
  /** Changes when the visit does, so a move or a cancel is read again. */
  refresh?: string;
  className?: string;
}) {
  const [events, setEvents] = useState<VisitEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    api<{ history?: VisitEvent[] }>(`/appointments/${encodeURIComponent(appointmentId)}`)
      .then((found) => live && setEvents(found.history ?? []))
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [appointmentId, refresh]);

  if (!events || !events.length) {
    return (
      <ol className={className}>
        {fallback}
        {children}
      </ol>
    );
  }
  return (
    <ol className={className}>
      {events.map((event) => {
        const { title, tone, icon } = step(event, audience);
        return (
          <li key={event.appointmentEventId}>
            <span className={`timeline-dot ${tone}`}>{icon}</span>
            <span>
              <span className="timeline-title">{title}</span>
              <span className="timeline-sub">
                {clock.day(event.occurredAt)}, {clock.time(event.occurredAt)}
                {event.reason ? ` · ${event.reason}` : ""}
              </span>
            </span>
          </li>
        );
      })}
      {children}
    </ol>
  );
}
