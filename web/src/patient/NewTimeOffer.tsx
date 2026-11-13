/**
 * A disrupted visit: the clinician is no longer available at its time, and
 * the patient chooses a new one in one tap (FR-STF-10).
 *
 * The next free times with the same clinician and the same kind of visit are
 * offered first, since that is what almost everybody wants. "Other times"
 * opens the full Move dialog. Nothing is moved until the patient taps; the
 * visit keeps its reference either way.
 */

import { useEffect, useState } from "react";

import { api, ApiError } from "../api/client";
import { describeFailure } from "../api/failure";
import { useOnReconnect } from "../api/network";
import { Notice } from "../components/controls";
import { Alert } from "../components/icons";
import { LoadingPane } from "../components/LoadingPane";
import { type Appointment, clock, usePatientData } from "./data";

interface Slot {
  startAt: string;
  endAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFERED = 3;

export function NewTimeOffer({
  appointment,
  onMoved,
  onMore,
}: {
  appointment: Appointment;
  onMoved: (moved: Appointment) => Promise<void>;
  onMore: () => void;
}) {
  const [offers, setOffers] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // After a drop mid-request: the move may have happened, so the visit is read again before anything is offered twice.
  const [unsure, setUnsure] = useState(false);
  const { reload } = usePatientData();
  // The times could not be read (not the same as there being none).
  const [unread, setUnread] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  useOnReconnect(() => setAgain((n) => n + 1));

  useEffect(() => {
    let live = true;
    const from = clock.isoDate(new Date());
    const to = clock.isoDate(new Date(Date.now() + 6 * DAY_MS));
    api<{ days: Record<string, Slot[]> }>(
      `/clinicians/${encodeURIComponent(appointment.clinicianProfileId ?? "")}/slots?from=${from}&to=${to}&typeId=${encodeURIComponent(appointment.appointmentTypeId)}`,
    )
      .then((found) => {
        if (!live) return;
        const all = Object.keys(found.days)
          .sort()
          .flatMap((date) => found.days[date] ?? []);
        setUnread(null);
        setOffers(all.slice(0, OFFERED));
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setUnread(describeFailure(caught).text);
        setOffers([]);
      });
    return () => {
      live = false;
    };
  }, [appointment.clinicianProfileId, appointment.appointmentTypeId, again]);

  async function take(slot: Slot) {
    setBusy(slot.startAt);
    setFailed(null);
    try {
      const moved = await api<Appointment>(`/appointments/${appointment.appointmentId}/reschedule`, {
        method: "POST",
        json: { startAt: slot.startAt },
      });
      await onMoved(moved);
    } catch (caught) {
      setBusy(null);
      if (caught instanceof ApiError && caught.status === 409) {
        // Only a conflict means the time is gone.
        setFailed("That time was just taken. Choose another.");
        setOffers((current) => current?.filter((s) => s.startAt !== slot.startAt) ?? null);
        return;
      }
      // Anything else leaves every offered time in place: the connection or the
      // server failed, not the slot. Nothing is tried again by itself.
      const why = describeFailure(caught, { write: true });
      setUnsure(why.outcomeUnknown);
      setFailed(
        why.outcomeUnknown
          ? `${why.text} Check your visit before choosing again.`
          : why.kind === "offline" || why.kind === "server"
            ? `${why.text} Your visit has not moved. The times above are still here.`
            : why.text,
      );
    }
  }

  return (
    <section className="new-time" aria-labelledby="new-time-title">
      <p className="new-time-head" id="new-time-title">
        <Alert size={16} />
        Your clinician can no longer see you at {clock.time(appointment.startAt)}. Choose a new time below; please don't come in at the old
        one.
      </p>
      {offers === null ? (
        <LoadingPane className="compact" label="Finding the next free times" />
      ) : offers.length ? (
        <div className="new-time-offers">
          {offers.map((slot) => (
            <button
              key={slot.startAt}
              type="button"
              className="new-time-offer"
              disabled={busy !== null}
              aria-busy={busy === slot.startAt || undefined}
              onClick={() => take(slot)}
            >
              <span className="new-time-day">{clock.day(slot.startAt)}</span>
              <span className="new-time-at">{clock.time(slot.startAt)}</span>
              <span className="new-time-take" aria-hidden="true">
                Book
              </span>
            </button>
          ))}
        </div>
      ) : unread ? (
        <Notice tone="error">
          {unread} The free times could not be read.{" "}
          <button type="button" className="link" onClick={() => setAgain((n) => n + 1)}>
            Try again
          </button>
        </Notice>
      ) : (
        <p className="empty">No free times this week with the same clinician.</p>
      )}
      {failed && (
        <Notice tone="error">
          {failed}
          {unsure && (
            <>
              {" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setUnsure(false);
                  setFailed(null);
                  void reload();
                }}
              >
                Check my visit
              </button>
            </>
          )}
        </Notice>
      )}
      <button type="button" className="outline-button" onClick={onMore} disabled={busy !== null}>
        Other times
      </button>
    </section>
  );
}
