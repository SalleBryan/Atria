/**
 * A queue ticket and a procedure request, as a patient reads them (FR-BKG-11, FR-BKG-14).
 *
 * A ticket shows the day and part of day, the facility, an arrival window,
 * the place as Nth of M, and that the patient is texted if the queue moves.
 * No doctor is named: one is assigned at check-in. A request holds no time; it
 * says so, shows what was asked, and when declined, why.
 *
 * Both extend the visit detail's Rev A look (Visits.tsx): the hero with its
 * cells, the two inner cards and the activity timeline.
 */

import { useEffect, useState } from "react";

import { api } from "../api/client";
import { Alert, Bell, CheckMark, Clock, Close, Mail } from "../components/icons";
import { type Appointment, clock, join, stateLabel, usePatientData } from "./data";

interface SessionSummary {
  sessionId: string;
  issuedTickets: number;
  partOfDay: "MORNING" | "AFTERNOON" | "EVENING";
  status: string;
  startTime: string;
  endTime: string;
}

const PART: Record<SessionSummary["partOfDay"], string> = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" };

export function useSession(sessionId: string | null | undefined) {
  const [found, setFound] = useState<SessionSummary | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    api<SessionSummary>(`/sessions/${encodeURIComponent(sessionId)}`)
      .then((data) => live && setFound(data))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sessionId]);
  return found;
}

export function TicketDetail({ appointment, actions }: { appointment: Appointment; actions: React.ReactNode }) {
  const { state } = usePatientData();
  const session = useSession(appointment.sessionId);
  if (state.status !== "ready") return null;
  const { clinic, type } = join(state.data, appointment);
  const status = stateLabel(appointment.state);
  const waiting = ["BOOKED", "CONFIRMED"].includes(appointment.state);
  const from = appointment.arrivalWindowStart ?? appointment.startAt;
  const until = appointment.arrivalWindowEnd ?? appointment.endAt;

  return (
    <>
      <div className={`visit-hero${waiting ? "" : ` visit-hero-${status.tone}`}`}>
        <span className="hero-bloom" aria-hidden="true" />
        <span className="hero-tag">{waiting ? "PLACE IN THE QUEUE" : status.label.toUpperCase()}</span>
        <h2>{clock.long(from)}</h2>
        <p>
          {[type?.name ?? "General consultation", session ? `${PART[session.partOfDay]} session` : null, clinic?.name]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <dl className="visit-cells">
          <div>
            <dt>ARRIVE FROM</dt>
            <dd>{clock.time(from)}</dd>
          </div>
          <div>
            <dt>UNTIL</dt>
            <dd>{clock.time(until)}</dd>
          </div>
          <div>
            <dt>PLACE</dt>
            <dd>{session ? `${appointment.position} of ${session.issuedTickets}` : appointment.position}</dd>
          </div>
          <div>
            <dt>REF</dt>
            <dd>{appointment.reference}</dd>
          </div>
        </dl>
      </div>

      <div className="visit-cols">
        <section className="panel inner-card" aria-labelledby="queue-title">
          <h3 id="queue-title">Your place</h3>
          <p className="queue-note">
            <Clock size={16} />
            Come to the {clinic?.name ?? "outpatient"} desk between {clock.time(from)} and {clock.time(until)}. A doctor is assigned when
            you check in.
          </p>
          <dl className="facts-list">
            <div>
              <dt>Unit</dt>
              <dd>{clinic?.name ?? "Not listed"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{clinic?.address ?? "Ask the desk"}</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>{session ? `${session.startTime} to ${session.endTime}` : "Loading"}</dd>
            </div>
            <div>
              <dt>If the queue moves</dt>
              <dd>We text you a new arrival time</dd>
            </div>
          </dl>
        </section>

        <section className="panel inner-card" aria-labelledby="ticket-activity">
          <h3 id="ticket-activity">Activity</h3>
          <ol className="timeline">
            <li>
              <span className="timeline-dot dot-done">
                <CheckMark size={11} />
              </span>
              <span>
                <span className="timeline-title">Place taken, number {appointment.position}</span>
                <span className="timeline-sub">
                  {clock.day(appointment.createdAt)}, {clock.time(appointment.createdAt)}
                </span>
              </span>
            </li>
            <li>
              <span className="timeline-dot dot-blue-tint">
                <Mail size={11} />
              </span>
              <span>
                <span className="timeline-title">Confirmation email sent</span>
                <span className="timeline-sub">With your arrival window</span>
              </span>
            </li>
            {appointment.state.endsWith("CANCELLED") ? (
              <li>
                <span className="timeline-dot dot-red">
                  <Close size={11} />
                </span>
                <span>
                  <span className="timeline-title">{status.label}</span>
                  <span className="timeline-sub">Your place was given back to the queue</span>
                </span>
              </li>
            ) : (
              <li>
                <span className="timeline-dot dot-amber-tint">
                  <Bell size={11} />
                </span>
                <span>
                  <span className="timeline-title">{waiting ? "Watching the queue for you" : status.label}</span>
                  <span className="timeline-sub">
                    {waiting ? "An SMS if your arrival time moves, and a reminder the day before" : "Thank you for coming"}
                  </span>
                </span>
              </li>
            )}
          </ol>
          {actions}
        </section>
      </div>
    </>
  );
}

export function RequestDetail({ appointment, actions }: { appointment: Appointment; actions: React.ReactNode }) {
  const { state } = usePatientData();
  if (state.status !== "ready") return null;
  const { clinic, type } = join(state.data, appointment);
  const status = stateLabel(appointment.state);
  const declined = appointment.state === "DECLINED";

  return (
    <>
      <div className={`visit-hero visit-hero-${declined ? "cancelled" : "awaiting"}`}>
        <span className="hero-bloom" aria-hidden="true" />
        <span className="hero-tag">{declined ? "NOT SCHEDULED" : "REQUESTED"}</span>
        <h2>{type?.name ?? "Procedure"}</h2>
        <p>{[clinic?.name, `asked on ${clock.day(appointment.createdAt)}`].filter(Boolean).join(" · ")}</p>
        <dl className="visit-cells">
          <div>
            <dt>STATUS</dt>
            <dd>{status.label}</dd>
          </div>
          <div>
            <dt>TIME</dt>
            <dd>{declined ? "None" : "To be set"}</dd>
          </div>
          <div>
            <dt>REF</dt>
            <dd>{appointment.reference}</dd>
          </div>
        </dl>
      </div>

      <div className="visit-cols">
        <section className="panel inner-card" aria-labelledby="request-title">
          <h3 id="request-title">Your request</h3>
          {declined ? (
            <p className="queue-note queue-note-declined">
              <Alert size={16} />
              {appointment.declineReason ?? "The unit could not schedule this."} You can book a consultation to talk it through.
            </p>
          ) : (
            <p className="queue-note">
              <Clock size={16} />
              No time is held yet. The unit sizes the procedure and places it with a clinician; you then confirm the time.
            </p>
          )}
          <dl className="facts-list">
            <div>
              <dt>Unit</dt>
              <dd>{clinic?.name ?? "Not listed"}</dd>
            </div>
            <div>
              <dt>What you wrote</dt>
              <dd>{appointment.requestNote ?? "Nothing added"}</dd>
            </div>
          </dl>
          {actions}
        </section>
      </div>
    </>
  );
}
