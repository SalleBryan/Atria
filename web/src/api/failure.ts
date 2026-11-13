/**
 * How the web client speaks of a failed request (audit F16): what kind it
 * was, the plain words for it, and whether a write may have gone through.
 */

import { ApiError } from "./client";

export type FailureKind = "offline" | "server" | "conflict" | "refused" | "other";

export interface Failure {
  kind: FailureKind;
  /** Plain words for the person, ending in a full stop. */
  text: string;
  /**
   * A write that left the device and was not answered: it may have gone
   * through. Never true for a read, nor for a request made while offline.
   */
  outcomeUnknown: boolean;
}

/** Sorts any thrown value: no connection, server trouble, a conflict, a refusal, or the rest. */
export function failureKind(error: unknown): FailureKind {
  if (!(error instanceof ApiError)) return "other";
  if (error.status === 0) return "offline";
  if (error.status === 409) return "conflict";
  if (error.status === 401 || error.status === 403) return "refused";
  if (error.status >= 500) return "server";
  return "other";
}

/**
 * The words for a failed request. Callers add what is specific to their
 * screen (what was kept, where to look); this says what happened and, for a
 * write (`write: true`), whether the outcome is known.
 */
export function describeFailure(error: unknown, options: { write?: boolean; fallback?: string } = {}): Failure {
  const { write = false, fallback = "That did not go through." } = options;
  const kind = failureKind(error);
  const outcomeUnknown = error instanceof ApiError && error.outcomeUnknown;
  if (kind === "offline") {
    return {
      kind,
      outcomeUnknown,
      text: outcomeUnknown
        ? "The connection dropped before we heard back, so we cannot tell whether it went through."
        : write
          ? "You are offline, so nothing was sent."
          : "We could not reach Atria. Check your connection.",
    };
  }
  if (kind === "server") {
    return {
      kind,
      outcomeUnknown,
      text: outcomeUnknown
        ? "Atria did not answer in time, so we cannot tell whether it went through."
        : "Atria is having trouble right now. Wait a moment and try again.",
    };
  }
  const message = error instanceof Error && error.message ? error.message : fallback;
  return { kind, outcomeUnknown: false, text: /[.!?]$/.test(message) ? message : `${message}.` };
}

/** True when trying the same thing again later could succeed without the person changing anything. */
export const isTransient = (error: unknown): boolean => ["offline", "server"].includes(failureKind(error));
