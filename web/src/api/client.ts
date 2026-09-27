/**
 * Calls to the Atria API, at /api on the page's own origin.
 *
 * The access token is what the authoriser reads (ADR 0017): the pre-token
 * trigger writes the tenant, person and roles into it, so the API resolves
 * the caller from the token alone. The id token is never sent.
 */

import { fetchAuthSession } from "aws-amplify/auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
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
  const response = await fetch(`/api${path}`, { ...init, headers, body });
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = (data as { message?: string } | undefined)?.message ?? `The request failed (${response.status}).`;
    throw new ApiError(response.status, message, (data as { detail?: unknown } | undefined)?.detail);
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
  const response = await fetch(`/api${path}`, { headers });
  if (!response.ok) {
    const data = (await response.json().catch(() => undefined)) as { message?: string; detail?: unknown } | undefined;
    throw new ApiError(response.status, data?.message ?? `The request failed (${response.status}).`, data?.detail);
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
  tenantId: string;
  roles: string[];
  patientProfileId: string | null;
  staffId: string | null;
  clinicId: string | null;
  phoneVerified: boolean;
  languages: string[];
  permissions: Record<string, string>;
  landing: string[];
  /** An administrator who has not signed in with an authenticator yet (FR-ACC-11). */
  secondFactorRequired?: boolean;
}
