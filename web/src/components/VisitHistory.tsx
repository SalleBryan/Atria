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
 *
 * Reminders come from the message log on the same read: once one is on
 * record the timeline says what happened to it (sent, delivered, failed, not
 * sent) in place of the screen's own "scheduled for" line.
 */

import { type ReactNode, useEffect, useState } from "react";

import { api } from "../api/client";
import { clock } from "../patient/data";
import { plainReason } from "../utils/messageReason";
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

export interface VisitReminder {
  channel: string;
  deliveryState: string;
  sentAt: string;
  settledAt: string | null;
  feedback: string | null;
  failureReason?: string | null;
}

type Audience = "patient" | "staff";

const REMINDER_STATE: Record<string, { word: string; tone: string }> = {
  SCHEDULED: { word: "being sent", tone: "dot-amber-tint" },
  SENT: { word: "sent", tone: "dot-done" },
  DELIVERED: { word: "delivered", tone: "dot-done" },
  FAILED: { word: "failed", tone: "dot-red" },
  CANCELLED: { word: "not sent", tone: "dot-amber-tint" },
};

function ReminderStep({ reminder, audience }: { reminder: VisitReminder; audience: Audience }) {
  const shown = REMINDER_STATE[reminder.deliveryState] ?? REMINDER_STATE.SENT!;
  const channel = reminder.channel === "SMS" ? "SMS" : "Email";
  const at = reminder.settledAt ?? reminder.sentAt;
  const why =
    audience === "staff" && (reminder.deliveryState === "FAILED" || reminder.deliveryState === "CANCELLED")
      ? reminder.feedback === "BOUNCE"
        ? "Bounced"
        : plainReason(reminder.failureReason ?? null, reminder.channel)
      : null;
  return (
    <li>
      <span className={`timeline-dot ${shown.tone}`}>{reminder.deliveryState === "FAILED" ? <Close size={11} /> : <Bell size={11} />}</span>
      <span>
        <span className="timeline-title">
          {channel} reminder {shown.word}
        </span>
        <span className="timeline-sub" title={audience === "staff" ? (reminder.failureReason ?? undefined) : undefined}>
          {clock.day(at)}, {clock.time(at)}
          {why ? ` · ${why}` : ""}
        </span>
      </span>
    </li>
  );
}

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
      return {
        title: event.actorRole === "SYSTEM" ? "Closed as not attended" : "Recorded as not attended",
        tone: "dot-red",
        icon: <User size={11} />,
      };
    default:
      return {
        title: event.kind.charAt(0) + event.kind.slice(1).toLowerCase().replace(/_/g, " "),
        tone: "dot-blue-tint",
        icon: <Bell size={11} />,
      };
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
  const [reminders, setReminders] = useState<VisitReminder[]>([]);

  useEffect(() => {
    let live = true;
    api<{ history?: VisitEvent[]; reminders?: VisitReminder[] }>(`/appointments/${encodeURIComponent(appointmentId)}`)
      .then((found) => {
        if (!live) return;
        setEvents(found.history ?? []);
        setReminders(found.reminders ?? []);
      })
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [appointmentId, refresh]);

  // What is still to come gives way to what happened, once it is on record.
  const after = reminders.length
    ? reminders.map((reminder, i) => (
        <ReminderStep key={`${reminder.channel}-${reminder.sentAt}-${i}`} reminder={reminder} audience={audience} />
      ))
    : children;
  if (!events || !events.length) {
    return (
      <ol className={className}>
        {fallback}
        {after}
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
      {after}
    </ol>
  );
}
