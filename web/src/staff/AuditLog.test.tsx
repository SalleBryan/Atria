import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { staffRoutes } from "./routes";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
  apiAll: (path: string) => api(path),
}));

const MANAGER = {
  personId: "p-mgr",
  givenName: "Rodrigue",
  familyName: "Owona",
  tenantId: "t-1",
  roles: ["CLINIC_MANAGER"],
  patientProfileId: null,
  staffId: "s-mgr",
  clinicId: "c-med",
} as unknown as Me;

const DESK = { ...MANAGER, personId: "p-desk", roles: ["RECEPTIONIST"] } as unknown as Me;

const ENTRIES = [
  {
    auditEntryId: "au-1",
    occurredAt: "2026-09-27T08:15:00Z",
    actorPersonId: "p-desk",
    actorName: "Nadine Fotso",
    actorRole: "RECEPTIONIST",
    action: "schedule.day",
    kind: "READ",
    subjectType: "CLINIC",
    subjectId: "c-med",
    clinicId: "c-med",
    patientCount: 9,
    reason: null,
    flags: [],
    source: { ip: "196.202.10.20" },
  },
  {
    auditEntryId: "au-2",
    occurredAt: "2026-09-27T07:05:00Z",
    actorPersonId: "p-doc",
    actorName: "Jean-Paul Nkoulou",
    actorRole: "CLINICIAN",
    action: "appointment.cancel",
    kind: "WRITE",
    subjectType: "APPOINTMENT",
    subjectId: "a-1",
    clinicId: "c-med",
    patientCount: 1,
    reason: "Clinician called away",
    flags: ["POTENTIAL_SELF_BENEFIT"],
    source: { ip: "196.202.10.21" },
  },
];

const asked: string[] = [];

function respond() {
  asked.length = 0;
  api.mockImplementation(async (path: string) => {
    asked.push(path);
    if (path === "/clinicians") return { clinicians: [] };
    if (path === "/clinics") return { clinics: [{ clinicId: "c-med", name: "Medical Outpatient Unit" }] };
    if (path === "/appointment-types") return { appointmentTypes: [] };
    if (path.startsWith("/clinics/")) return { appointments: [], patients: {} };
    if (path.startsWith("/audit?")) {
      const kind = new URL(path, "http://x").searchParams.get("kind");
      const entries = ENTRIES.filter((e) => !kind || e.kind === kind);
      return {
        from: "2026-09-21",
        to: "2026-09-27",
        count: entries.length,
        nextCursor: null,
        entries,
        actors: [
          { personId: "p-doc", name: "Jean-Paul Nkoulou", role: "CLINICIAN" },
          { personId: "p-desk", name: "Nadine Fotso", role: "RECEPTIONIST" },
        ],
        actions: ["appointment.cancel", "schedule.day"],
      };
    }
    throw new Error(`unexpected ${path}`);
  });
}

function renderLog(me: Me = MANAGER) {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={["/console/audit"]}>
        <Routes>
          {staffRoutes}
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("Audit log", () => {
  beforeEach(respond);

  it("lists who did what, to how many patients, and from where (FR-ADM-04)", async () => {
    renderLog();
    const list = await screen.findByRole("region", { name: "Audit entries" });
    expect(await within(list).findByText("Viewed a unit's day")).toBeInTheDocument();
    expect(within(list).getByText("9 patients")).toBeInTheDocument();
    expect(within(list).getByText("196.202.10.20")).toBeInTheDocument();
    expect(within(list).getByText("“Clinician called away”")).toBeInTheDocument();
    expect(within(list).getByText("Near their own visit")).toBeInTheDocument();
  });

  it("asks for a week by default, and today when chosen", async () => {
    renderLog();
    await screen.findByText("Viewed a unit's day");
    expect(asked.find((p) => p.startsWith("/audit?"))).toMatch(/from=.*&to=/);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Today" }));
    const last = asked.filter((p) => p.startsWith("/audit?")).at(-1)!;
    const ask = new URL(last, "http://x").searchParams;
    expect(ask.get("from")).toBe(ask.get("to"));
  });

  it("filters to changes from the menu", async () => {
    const user = userEvent.setup();
    renderLog();
    await screen.findByText("Viewed a unit's day");
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(await screen.findByRole("radio", { name: "Changes" }));
    expect(asked.at(-1)).toContain("kind=WRITE");
    expect(await screen.findByText("1 entry")).toBeInTheDocument();
  });

  it("is in the navigation for a unit manager", async () => {
    renderLog();
    const links = await screen.findAllByRole("link", { name: "Audit log" });
    for (const link of links) expect(link).toHaveAttribute("aria-current", "page");
  });

  it("is not offered to the front desk", async () => {
    renderLog(DESK);
    expect(screen.queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
    expect(asked.some((p) => p.startsWith("/audit"))).toBe(false);
  });
});
