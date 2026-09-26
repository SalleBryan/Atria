import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { staffRoutes } from "./routes";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
  apiAll: (path: string) => api(path),
}));

function person(roles: string[], staffId: string): Me {
  return { personId: "p-1", givenName: "Ada", familyName: "Nkeng", tenantId: "t-1", roles, patientProfileId: null, staffId, clinicId: "c-med" } as unknown as Me;
}

const CLINICIANS = [
  { clinicianProfileId: "s-tabi", clinicId: "c-med", givenName: "Ernest", familyName: "Tabi", specialty: "Internal medicine" },
  { clinicianProfileId: "s-bello", clinicId: "c-med", givenName: "Aicha", familyName: "Bello", specialty: "Dermatology" },
];

function respond(extra: (path: string, init?: { method?: string; json?: unknown }) => unknown = () => undefined) {
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    const answer = extra(path, init);
    if (answer !== undefined) return answer;
    if (path === "/clinicians") return { clinicians: CLINICIANS };
    if (path === "/clinics") return { clinics: [{ clinicId: "c-med", name: "Medical Outpatient Unit" }] };
    if (path === "/appointment-types") return { appointmentTypes: [] };
    if (path.endsWith("/availability")) {
      return { clinicianProfileId: "s-tabi", usesUnitHours: true, hours: {}, unitHours: { "0": { start: "08:00", end: "16:00" } }, timeOff: [] };
    }
    throw new Error(`unexpected ${path}`);
  });
}

function renderAs(me: Me) {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={["/console/availability"]}>
        <Routes>{staffRoutes}</Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("Availability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fr_dir_03: a clinician saves their own week, days left off are days off", async () => {
    respond((_path, init) => (init?.method === "PUT" ? { hours: {} } : undefined));
    renderAs(person(["CLINICIAN"], "s-tabi"));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Save hours" }));
    const put = api.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[0]).toBe("/clinicians/s-tabi/hours");
    expect((put?.[1] as { json: { days: Record<string, unknown> } }).json.days["0"]).toEqual({ start: "08:00", end: "16:00" });
    expect((put?.[1] as { json: { days: Record<string, unknown> } }).json.days["1"]).toBeNull();
    expect(await screen.findByText(/Working hours saved/)).toBeInTheDocument();
  });

  it("fr_stf_10: the desk marks a clinician unavailable and hears how many patients were asked", async () => {
    respond((path, init) => (path.endsWith("/time-off") && init?.method === "POST" ? { disrupted: [{}, {}] } : undefined));
    renderAs(person(["RECEPTIONIST"], "s-desk"));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Take time off" }));
    const dialog = screen.getByRole("dialog", { name: "Take time off" });
    // The desk may only mark unavailable, so there is no choice of kind.
    expect(within(dialog).queryByRole("radio", { name: "Leave" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Called away");
    await user.click(within(dialog).getByRole("button", { name: "Take time off" }));
    expect(await screen.findByText(/2 visits were disrupted/)).toBeInTheDocument();
  });

  it("the desk cannot change working hours", async () => {
    respond();
    renderAs(person(["RECEPTIONIST"], "s-desk"));
    await screen.findByRole("heading", { name: "Working hours" });
    expect(screen.queryByRole("button", { name: "Save hours" })).not.toBeInTheDocument();
  });
});
