/**
 * What the web client knows about the connection, and how it speaks of a
 * failed request (audit F16).
 *
 * Two signals feed it. The browser says whether the device is online at all
 * (`navigator.onLine`); that is cheap but it cannot see a Wi-Fi link with no
 * internet behind it, which is the usual case on a weak network. So the API
 * client also reports each request: a response of any kind means Atria is
 * reachable, a request that dies without one means it is not.
 *
 * Nothing here stores anything about the person or their visits.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

/* ------------------------------------------------------------ reachability */

let reachable = true;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** The API client calls this after every request: true when any response came back. */
export function reportReachable(ok: boolean): void {
  if (reachable === ok) return;
  reachable = ok;
  emit();
}

export const deviceOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

export type Connection = "online" | "offline" | "unreachable";

/** Offline: the device has no network. Unreachable: it has one, but Atria did not answer. */
export function connectionNow(): Connection {
  if (!deviceOnline()) return "offline";
  return reachable ? "online" : "unreachable";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const wake = () => {
    // The browser coming back online is a hint, not proof: assume Atria can
    // be reached again and let the next request say otherwise.
    if (deviceOnline()) reachable = true;
    emit();
  };
  window.addEventListener("online", wake);
  window.addEventListener("offline", wake);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", wake);
  };
}

export function useConnection(): Connection {
  return useSyncExternalStore(subscribe, connectionNow, () => "online" as const);
}

/** Runs `callback` each time the connection returns after being lost, so a screen can read again. */
export function useOnReconnect(callback: () => void): void {
  const connection = useConnection();
  const latest = useRef(callback);
  latest.current = callback;
  const before = useRef(connection);
  useEffect(() => {
    if (before.current !== "online" && connection === "online") latest.current();
    before.current = connection;
  }, [connection]);
}

/* ------------------------------------------------------------ polling */

/**
 * Runs `read` every `everyMs` while it can be useful, and never otherwise.
 *
 * - Paused while the device is offline or the tab is hidden; resumes with an
 *   immediate read when either ends.
 * - After a failed read (one that throws), waits twice as long, up to eight
 *   times, then returns to the normal pace on the first success.
 * - Only for reads. A write must never be handed to this.
 *
 * Returns a function that stops it.
 */
export function startPolling(read: () => unknown, everyMs: number, options: { immediate?: boolean } = {}): () => void {
  let timer: number | undefined;
  let stopped = false;
  let failures = 0;
  let busy = false;

  const paused = () => !deviceOnline() || (typeof document !== "undefined" && document.visibilityState === "hidden");
  const schedule = () => {
    window.clearTimeout(timer);
    if (!stopped) timer = window.setTimeout(() => void tick(), everyMs * Math.min(2 ** failures, 8));
  };

  async function tick() {
    if (stopped || busy) return;
    // Paused: nothing is scheduled. `resume` starts it again.
    if (paused()) return;
    busy = true;
    try {
      await read();
      failures = 0;
    } catch {
      failures += 1;
    } finally {
      busy = false;
    }
    schedule();
  }

  const resume = () => {
    if (stopped || paused()) return;
    failures = 0;
    window.clearTimeout(timer);
    void tick();
  };

  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", resume);
  if (options.immediate) void tick();
  else schedule();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener("online", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
