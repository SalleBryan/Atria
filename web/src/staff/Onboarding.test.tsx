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

const ADMIN = {
  personId: "p-admin",
  givenName: "Admin",
  familyName: "One",
  tenantId: "t-1",
  roles: ["TENANT_ADMIN"],
  patientProfileId: null,
  staffId: "s-admin",
  clinicId: null,
} as unknown as Me;

const COMPLETE = {
  clinicId: "u-med",
  name: "Medical Unit",
  address: "Main road",
  phone: "+237600000001",
  openingHours: { mon: { start: "08:00", end: "16:00" } },
};
const BARE = { clinicId: "u-new", name: "New Unit", address: null, phone: null, openingHours: null };

function respond(patients: unknown[]) {
  api.mockImplementation(async (path: string) => {
    if (path === "/clinicians") return { clinicians: [{ clinicianProfileId: "c-1", clinicId: "u-med" }] };
    if (path === "/clinics") return { clinics: [COMPLETE, BARE] };
    if (path === "/appointment-types") {
      return { appointmentTypes: [{ appointmentTypeId: "t-1", name: "Consult", clinicIds: ["u-med"], feeAmountMinor: 5000 }] };
    }
    if (path === "/patients") return { results: patients };
    throw new Error(`unexpected ${path}`);
  });
}

function renderAt(me: Me) {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={["/console/onboarding"]}>
        <Routes>
          {staffRoutes}
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("Set up a unit (B4)", () => {
  it("shows a finished unit as done", async () => {
    respond([{ patientProfileId: "pp-1" }]);
    renderAt(ADMIN);
    const steps = await screen.findByRole("region", { name: "Steps" });
    expect(await screen.findByText(/5 of 5 steps done for Medical Unit/)).toBeInTheDocument();
    expect(within(steps).getAllByText("Done")).toHaveLength(5);
  });

  it("says what a new unit still needs", async () => {
    respond([]);
    renderAt(ADMIN);
    await screen.findByRole("region", { name: "Steps" });
    await userEvent.setup().click(screen.getByRole("button", { name: /Unit/ }));
    await userEvent.setup().click(await screen.findByRole("option", { name: "New Unit" }));
    expect(await screen.findByText(/0 of 5 steps done for New Unit/)).toBeInTheDocument();
    expect(screen.getByText("Nothing can be booked here until a visit type is offered.")).toBeInTheDocument();
    expect(screen.getByText("Offer a visit type first.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open Staff accounts" })).toHaveLength(1);
  });

  it("is the administrator's", async () => {
    respond([]);
    renderAt({ ...ADMIN, roles: ["RECEPTIONIST"], clinicId: "u-med" } as unknown as Me);
    await screen.findAllByRole("link", { name: "Schedule" });
    expect(screen.queryByRole("heading", { name: "Set up a unit" })).not.toBeInTheDocument();
  });
});
