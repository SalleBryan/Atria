/**
 * Calls to the Atria API, at /api on the page's own origin.
 *
 * The access token is what the authoriser reads (ADR 0017): the pre-token
 * trigger writes the tenant, person and roles into it, so the API resolves
 * the caller from the token alone. The id token is never sent.
 */

import { fetchAuthSession } from "aws-amplify/auth";

import { deviceOnline, reportReachable } from "./network";

/**
 * A failed request. Status 0 means no response ever came back: the device is
 * offline or Atria did not answer. `outcomeUnknown` is then true for a write
 * that left the device, since the server may have acted before the link broke.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Reads (GET) that fail for want of a connection, or because the gateway had
 * a moment of trouble, are asked again after these pauses. Nothing else is
 * ever retried by the client: a write that is repeated could book twice or
 * cancel twice, so a person retries it on purpose.
 */
export const READ_RETRY_PAUSES_MS = [600, 1800];
const GATEWAY_TROUBLE = new Set([502, 503, 504]);
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** The body as JSON; a gateway's HTML error page is not a reason to crash on parse. */
function parsed(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * What API Gateway says for a route it does not have, which is what a screen
 * newer than the deployed API meets (2026-10-07): an administrator read
 * "check the connection" when the server simply lacked the feature.
 */
const UNKNOWN_ROUTE = "Missing Authentication Token";

function messageOf(status: number, data: unknown): string {
  const message = (data as { message?: string } | undefined)?.message;
  if (status === 403 && message === UNKNOWN_ROUTE) {
    return "The server does not offer this yet. It arrives with the next update of the system.";
  }
  return message ?? `The request failed (${status}).`;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  // No session, or none that can be read, sends the request without a token:
  // the authoriser then refuses it, which is the honest answer.
  const session = await fetchAuthSession().catch(() => undefined);
  const token = session?.tokens?.accessToken?.toString();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const method = (init.method ?? "GET").toUpperCase();
  const isRead = method === "GET";
  const wasOnline = deviceOnline();
  let response: Response;
  let text: string;
  for (let tries = 0; ; tries += 1) {
    try {
      response = await fetch(`/api${path}`, { ...init, headers, body });
      text = await response.text();
    } catch {
      reportReachable(false);
      if (isRead && wasOnline && deviceOnline() && tries < READ_RETRY_PAUSES_MS.length) {
        await pause(READ_RETRY_PAUSES_MS[tries]!);
        continue;
      }
      throw new ApiError(0, "Atria could not be reached.", undefined, !isRead && wasOnline);
    }
    if (isRead && GATEWAY_TROUBLE.has(response.status) && tries < READ_RETRY_PAUSES_MS.length) {
      await pause(READ_RETRY_PAUSES_MS[tries]!);
      continue;
    }
    break;
  }
  // Any answer, even an error, means Atria can be reached.
  reportReachable(true);
  const data = parsed(text);
  if (!response.ok) {
    // A gateway that timed out on a write may have passed it on first.
    const ambiguous = !isRead && (response.status === 502 || response.status === 504);
    throw new ApiError(response.status, messageOf(response.status, data), (data as { detail?: unknown } | undefined)?.detail, ambiguous);
  }
  return data as T;
}

/**
 * A file the API sends, such as an export, with the name it suggests. Errors
 * still arrive as JSON and are thrown as ApiError, as `api` does.
 */
export async function apiFile(path: string): Promise<{ blob: Blob; name: string | null }> {
  const session = await fetchAuthSession().catch(() => undefined);
  const token = session?.tokens?.accessToken?.toString();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { headers });
  } catch {
    reportReachable(false);
    throw new ApiError(0, "Atria could not be reached.");
  }
  reportReachable(true);
  if (!response.ok) {
    const data = (await response.json().catch(() => undefined)) as { message?: string; detail?: unknown } | undefined;
    throw new ApiError(response.status, messageOf(response.status, data), data?.detail);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  return { blob: await response.blob(), name: /filename="([^"]+)"/.exec(disposition)?.[1] ?? null };
}

/**
 * Every item of a list the API pages (NFR-PERF-04), for a screen that needs
 * the whole of it, such as the directory its filters are built from. The
 * first request is the plain address, whose page is the API's longest (50);
 * each later one passes back the page's `nextCursor`. The pages' `key` lists
 * are joined, and so are any `patients` names that come with them.
 */
export async function apiAll<T extends { nextCursor?: string | null }>(path: string, key: keyof T & string): Promise<T> {
  const first = await api<T>(path);
  const items = [...(((first as Record<string, unknown>)[key] as unknown[] | undefined) ?? [])];
  let patients = (first as { patients?: Record<string, unknown> }).patients;
  let cursor = first.nextCursor;
  const join = path.includes("?") ? "&" : "?";
  // A guard against a list that never ends: 200 pages is ten thousand items.
  for (let pages = 1; cursor && pages < 200; pages += 1) {
    const next = await api<T>(`${path}${join}cursor=${encodeURIComponent(cursor)}`);
    items.push(...(((next as Record<string, unknown>)[key] as unknown[] | undefined) ?? []));
    const more = (next as { patients?: Record<string, unknown> }).patients;
    if (more) patients = { ...patients, ...more };
    cursor = next.nextCursor;
  }
  return { ...first, [key]: items, ...(patients ? { patients } : {}), nextCursor: null };
}

/** GET /me: the caller as the API resolves them. */
export interface Me {
  personId: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phoneE164: string | null;
  /** YYYY-MM-DD, when given. */
  dateOfBirth?: string | null;
  tenantId: string;
  roles: string[];
  patientProfileId: string | null;
  staffId: string | null;
  clinicId: string | null;
  phoneVerified: boolean;
  languages: string[];
  /** The language the person chose, from the region pack's list. */
  preferredLanguage?: string | null;
  permissions: Record<string, string>;
  landing: string[];
  /** An administrator who has not signed in with an authenticator yet (FR-ACC-11). */
  secondFactorRequired?: boolean;
  /** What a patient's record still lacks: "phone", "dateOfBirth", "terms" (2026-09-29). */
  missing?: string[];
  /** A deletion waiting out its 30 days (services/identity/deletion.py). */
  deletion?: { purgeAt: string; requestedAt: string; by: "SELF" | "ADMIN"; graceDays: number } | null;
}
