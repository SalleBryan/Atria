import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes } from "react-router-dom";

import { ApiError, type Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { clock } from "../patient/data";
import { staffRoutes } from "./routes";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

const HOUR = 3600 * 1000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");

const DESK = {
  personId: "p-desk",
  givenName: "Nadine",
  familyName: "Fotso",
  tenantId: "t-1",
  roles: ["RECEPTIONIST"],
  patientProfileId: null,
  staffId: "s-desk",
  clinicId: "c-akwa",
} as unknown as Me;

const VISIT = {
  appointmentId: "a-1",
  reference: "APT-4194",
  clinicId: "c-akwa",
  patientProfileId: "pp-ama",
  appointmentTypeId: "at-follow",
  clinicianProfileId: "s-mbarga",
  startAt: at(72),
  endAt: at(72.5),
  state: "BOOKED",
  channel: "WALK_IN",
  bookedByRole: "RECEPTIONIST",
  createdAt: at(-24),
  version: 1,
};

function respond(visit: Record<string, unknown> | Error = VISIT) {
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    if (path === "/clinicians") {
      return { clinicians: [{ clinicianProfileId: "s-mbarga", clinicId: "c-akwa", givenName: "Esther", familyName: "Mbarga", specialty: "Paediatrics" }] };
    }
    if (path === "/clinics") return { clinics: [{ clinicId: "c-akwa", name: "Clinique d'Akwa" }] };
    if (path === "/appointment-types") return { appointmentTypes: [{ appointmentTypeId: "at-follow", name: "Follow-up consultation", cancellationWindowMinutes: 1440 }] };
    if (path.startsWith("/clinics/c-akwa/day")) return { appointments: [VISIT], patients: { "pp-ama": { givenName: "Ama", familyName: "Darko" } } };
    if (path === "/appointments/a-1" && init?.method === "DELETE") return { ...VISIT, state: "CLINIC_CANCELLED", outcome: "CLINIC_CANCELLED" };
    if (path === "/appointments/a-1") {
      if (visit instanceof Error) throw visit;
      return visit;
    }
    throw new Error(`unexpected ${path}`);
  });
}

function renderVisit(path = "/console/visits/a-1") {
  const session = { state: { status: "signed-in", me: DESK, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{staffRoutes}</Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("One visit, from the desk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fr_vis_02: names the patient from the day the visit sits on", async () => {
    respond();
    renderVisit();
    expect(await screen.findByRole("heading", { name: "Ama Darko", level: 1 })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(`/clinics/c-akwa/day?date=${clock.isoDate(VISIT.startAt)}`);
    const hero = screen.getByRole("region", { name: "Visit" });
    expect(hero).toHaveTextContent("Follow-up consultation · 30 minutes · booked by the front desk");
    expect(hero).toHaveTextContent(clock.time(VISIT.startAt));
  });

  it("states what the record holds, and no more", async () => {
    respond();
    renderVisit();
    const facts = await screen.findByRole("region", { name: "Appointment" });
    expect(facts).toHaveTextContent("APT-4194");
    expect(facts).toHaveTextContent("Clinique d'Akwa");
    expect(facts).toHaveTextContent("At the desk");
    expect(facts).toHaveTextContent("Dr Esther Mbarga");
    expect(facts).not.toHaveTextContent(/fee|room|notes/i);
  });

  it("fr_vis_03: cancels from the page, and the page shows it", async () => {
    respond();
    renderVisit();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel visit" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel this appointment?" });
    await user.click(within(dialog).getByRole("radio", { name: "Clinic closure" }));
    respond({ ...VISIT, state: "CLINIC_CANCELLED" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel appointment" }));
    expect(await screen.findByText(/APT-4194 cancelled/)).toBeInTheDocument();
    expect(await screen.findByText("CANCELLED BY CLINIC")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel visit" })).not.toBeInTheDocument();
  });

  it("says plainly when the visit is not the caller's to see", async () => {
    respond(new ApiError(403, "not permitted"));
    renderVisit();
    expect(await screen.findByText("This visit is not on a list you can see.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the day" })).toBeInTheDocument();
  });
});
