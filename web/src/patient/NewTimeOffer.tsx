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

import { api } from "../api/client";
import { Notice } from "../components/controls";
import { Alert } from "../components/icons";
import { LoadingPane } from "../components/LoadingPane";
import { type Appointment, clock } from "./data";

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
        setOffers(all.slice(0, OFFERED));
      })
      .catch(() => live && setOffers([]));
    return () => {
      live = false;
    };
  }, [appointment.clinicianProfileId, appointment.appointmentTypeId]);

  async function take(slot: Slot) {
    setBusy(slot.startAt);
    setFailed(null);
    try {
      const moved = await api<Appointment>(`/appointments/${appointment.appointmentId}/reschedule`, {
        method: "POST",
        json: { startAt: slot.startAt },
      });
      await onMoved(moved);
    } catch {
      setFailed("That time was just taken. Choose another.");
      setBusy(null);
      setOffers((current) => current?.filter((s) => s.startAt !== slot.startAt) ?? null);
    }
  }

  return (
    <section className="new-time" aria-labelledby="new-time-title">
      <p className="new-time-head" id="new-time-title">
        <Alert size={16} />
        Your clinician can no longer see you at {clock.time(appointment.startAt)}. Choose a new time below; please don't come in at the old one.
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
      ) : (
        <p className="empty">No free times this week with the same clinician.</p>
      )}
      {failed && <Notice tone="error">{failed}</Notice>}
      <button type="button" className="outline-button" onClick={onMore} disabled={busy !== null}>
        Other times
      </button>
    </section>
  );
}
