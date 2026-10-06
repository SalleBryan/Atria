import { render, screen, within } from "@testing-library/react";
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
  clinicId: "u-med",
} as unknown as Me;
const DESK = { ...MANAGER, roles: ["RECEPTIONIST"] } as unknown as Me;

const WEEK = {
  clinicId: "u-med",
  clinicName: "Medical Unit",
  week: "2026-09-21",
  to: "2026-09-27",
  firstDay: "2026-09-19",
  booked: 10,
  attended: 6,
  noShow: 2,
  cancelled: 1,
  lateCancelled: 1,
  open: 0,
  attendance: 0.75,
  byChannel: [{ channel: "PHONE", booked: 4, attended: 3, noShow: 1, attendance: 0.75 }],
  byReminder: [{ reminder: "FAILED", booked: 2, attended: 1, noShow: 1, attendance: 0.5 }],
  ledger: {
    entries: 10,
    currency: "XAF",
    byEntitlement: [{ entitlement: "PARTIAL", entries: 1, amountMinor: 5000 }],
    byBand: [{ practice: "Specialist, first visit", entries: 6, amountMinor: 30000 }],
  },
};

const asked: string[] = [];

function respond() {
  asked.length = 0;
  api.mockImplementation(async (path: string) => {
    asked.push(path);
    if (path === "/clinicians") return { clinicians: [] };
    if (path === "/clinics") return { clinics: [{ clinicId: "u-med", name: "Medical Unit" }] };
    if (path === "/appointment-types") return { appointmentTypes: [] };
    if (path.startsWith("/clinics/u-med/day")) return { appointments: [], patients: {} };
    if (path.startsWith("/clinics/u-med/report")) return WEEK;
    throw new Error(`unexpected ${path}`);
  });
}

function renderAt(me: Me) {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={["/console/reports"]}>
        <Routes>
          {staffRoutes}
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("Weekly report", () => {
  beforeEach(respond);

  it("shows the unit's week (FR-MSR-01)", async () => {
    renderAt(MANAGER);
    const tiles = await screen.findByRole("region", { name: "The week in numbers" });
    expect(within(tiles).getByText("75%")).toBeInTheDocument();
    expect(within(tiles).getByText("Late cancelled")).toBeInTheDocument();
    expect(asked.some((p) => p.startsWith("/clinics/u-med/report?week="))).toBe(true);
  });

  it("breaks attendance down by channel and reminder (FR-MSR-02)", async () => {
    renderAt(MANAGER);
    expect(await screen.findByText("By phone")).toBeInTheDocument();
    expect(screen.getByText("Reminder failed")).toBeInTheDocument();
  });

  it("shows the ledger as a record and claims no saving (FR-MSR-04, FR-MSR-07)", async () => {
    renderAt(MANAGER);
    expect(await screen.findByText("Partial refund")).toBeInTheDocument();
    expect(screen.getByText(/No money moves through Atria/)).toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/sav(ed|ing)/);
  });

  it("is not the front desk's", async () => {
    renderAt(DESK);
    expect(screen.queryByRole("link", { name: "Reports" })).not.toBeInTheDocument();
  });
});
