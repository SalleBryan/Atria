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
    const message =
      (data as { message?: string } | undefined)?.message ?? `The request failed (${response.status}).`;
    throw new ApiError(response.status, message, (data as { detail?: unknown } | undefined)?.detail);
  }
  return data as T;
}

/** GET /me: the caller as the API resolves them. */
export interface Me {
  personId: string;
  givenName: string | null;
  familyName: string | null;
  tenantId: string;
  roles: string[];
  patientProfileId: string | null;
  staffId: string | null;
  clinicId: string | null;
  phoneVerified: boolean;
  languages: string[];
  permissions: Record<string, string>;
  landing: string[];
}
