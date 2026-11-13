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
import { startPolling } from "../api/network";
import { Notice } from "../components/controls";
import { Alert, Bell, CheckMark, Clock, Close, Mail } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { type Appointment, clock, join, stateLabel, ticketWaits, usePatientData } from "./data";

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

/** How often a waiting patient's place is read again. */
const TICKET_REFRESH_MS = 30_000;

/** An early-call invitation to come sooner (ADR 0022 R4). Answering moves nobody. */
interface Invite {
  status: "open" | "accepted" | "declined" | "expired";
  expiresAt: string;
  answer: "YES" | "NO" | null;
  eta: string | null;
}

interface Outlook {
  ahead: number;
  expectedStartAt: string;
  next: boolean;
  invite?: Invite | null;
}

/**
 * The patient's own place, live: patients ahead and when they are likely to be seen.
 *
 * Read again every 30 seconds while the device is online and the tab is
 * showing; paused otherwise, and read at once when either ends (audit F16).
 * When a read fails the last answer stays, with the time it was true, so the
 * screen can say it may be out of date instead of showing nothing.
 */
export function useOutlook(appointmentId: string, active: boolean) {
  const [found, setFound] = useState<Outlook | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const stop = startPolling(
      () =>
        api<Outlook>(`/appointments/${encodeURIComponent(appointmentId)}/ticket`).then(
          (data) => {
            if (!live) return;
            setFound(data);
            setAsOf(Date.now());
            setStale(false);
          },
          (error: unknown) => {
            if (live) setStale(true);
            // Thrown on, so the poller backs off.
            throw error;
          },
        ),
      TICKET_REFRESH_MS,
      { immediate: true },
    );
    return () => {
      live = false;
      stop();
    };
  }, [appointmentId, active]);
  return { found, asOf, stale };
}

/** The patient's answer to "can you come sooner?": a button, never a free-text reply. */
function InviteReply({ appointmentId, invite }: { appointmentId: string; invite: Invite }) {
  const [shown, setShown] = useState(invite);
  const [busy, setBusy] = useState<"YES" | "NO" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => setShown(invite), [invite]);

  async function answer(choice: "YES" | "NO") {
    setBusy(choice);
    setFailure(null);
    try {
      const done = await api<{ invite: Invite }>(`/appointments/${encodeURIComponent(appointmentId)}/invite-reply`, {
        method: "POST",
        json: { answer: choice },
      });
      setShown(done.invite);
    } catch {
      setFailure("That did not go through. Try again, or tell the desk when you arrive.");
    } finally {
      setBusy(null);
    }
  }

  if (shown.status === "expired") return null;
  return (
    <div className="queue-invite" role="group" aria-label="A doctor is free sooner">
      {shown.status === "open" ? (
        <>
          <p className="queue-note">
            <Bell size={16} />A doctor is free sooner. Can you be at the desk by {clock.time(shown.expiresAt)}? Your place does not change
            whatever you answer.
          </p>
          <div className="queue-invite-actions">
            <button
              type="button"
              className="tonal-button"
              disabled={busy !== null}
              aria-busy={busy === "YES" || undefined}
              onClick={() => void answer("YES")}
            >
              {busy === "YES" ? <LoadingIndicator size={18} label="Sending" /> : null}
              Yes, I am coming
            </button>
            <button
              type="button"
              className="outline-button"
              disabled={busy !== null}
              aria-busy={busy === "NO" || undefined}
              onClick={() => void answer("NO")}
            >
              {busy === "NO" ? <LoadingIndicator size={18} label="Sending" /> : null}
              No, keep my place
            </button>
          </div>
          {failure && <p className="queue-note queue-note-declined">{failure}</p>}
        </>
      ) : shown.status === "accepted" ? (
        <p className="queue-note">
          <CheckMark size={16} />
          Thank you. We expect you by {clock.time(shown.eta ?? shown.expiresAt)}. Check in at the desk when you arrive.
        </p>
      ) : (
        <p className="queue-note">
          <CheckMark size={16} />
          Understood. Your place is unchanged.
        </p>
      )}
    </div>
  );
}

export function TicketDetail({ appointment, actions }: { appointment: Appointment; actions: React.ReactNode }) {
  const { state } = usePatientData();
  const session = useSession(appointment.sessionId);
  const waitingNow = ticketWaits(appointment.state) || appointment.state === "ARRIVED";
  const { found: outlook, asOf, stale } = useOutlook(appointment.appointmentId, waitingNow);
  if (state.status !== "ready") return null;
  const { clinic, type } = join(state.data, appointment);
  const status = stateLabel(appointment.state);
  const waiting = ticketWaits(appointment.state);
  const cancelled = appointment.state.endsWith("CANCELLED");
  const checkedIn = ["ARRIVED", "IN_CONSULTATION"].includes(appointment.state);
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
        {waiting ? (
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
        ) : (
          // A ticket that is no longer waiting gives no arrival instruction (audit F03).
          <dl className="visit-cells">
            <div>
              <dt>STATUS</dt>
              <dd>{status.label}</dd>
            </div>
            <div>
              <dt>{cancelled ? "WINDOW WAS" : "WINDOW"}</dt>
              <dd>{`${clock.time(from)} to ${clock.time(until)}`}</dd>
            </div>
            <div>
              <dt>REF</dt>
              <dd>{appointment.reference}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="visit-cols">
        <section className="panel inner-card" aria-labelledby="queue-title">
          <h3 id="queue-title">{waiting ? "Your place" : "This booking"}</h3>
          <p className="queue-note">
            <Clock size={16} />
            {waiting
              ? `Come to the ${clinic?.name ?? "outpatient"} desk between ${clock.time(from)} and ${clock.time(until)}. A doctor is assigned when you check in.`
              : cancelled
                ? "You no longer have a place in this queue, and you do not need to come for this booking. Take a new place from Find care if you still want to be seen."
                : checkedIn
                  ? "You are checked in. A doctor is assigned from the queue as one becomes free."
                  : "This visit is closed. It stays in your history."}
          </p>
          {stale && outlook && asOf && waitingNow ? (
            <Notice tone="info">
              We could not refresh your place. It was last updated at {clock.time(new Date(asOf).toISOString())} and may have changed. We
              keep trying, and come to the desk as planned if you are unsure.
            </Notice>
          ) : null}
          {outlook?.invite && waiting ? <InviteReply appointmentId={appointment.appointmentId} invite={outlook.invite} /> : null}
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
            {outlook && waitingNow ? (
              <>
                <div>
                  <dt>Ahead of you</dt>
                  <dd>{outlook.next ? "No one, you are next" : outlook.ahead === 1 ? "1 patient" : `${outlook.ahead} patients`}</dd>
                </div>
                <div>
                  <dt>Likely to be seen around</dt>
                  <dd>{clock.time(outlook.expectedStartAt)}, an estimate that updates here</dd>
                </div>
              </>
            ) : null}
            {waiting ? (
              <div>
                <dt>If the queue moves</dt>
                <dd>We text you a new arrival time</dd>
              </div>
            ) : null}
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
