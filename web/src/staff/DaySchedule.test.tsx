import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { clock } from "../patient/data";
import { shiftDate, today } from "./data";
import { staffRoutes } from "./routes";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

const HOUR = 3600 * 1000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");

const DESK: Me = {
  personId: "p-desk",
  givenName: "Nadine",
  familyName: "Fotso",
  email: null,
  phoneE164: null,
  tenantId: "t-1",
  roles: ["RECEPTIONIST"],
  patientProfileId: null,
  staffId: "s-desk",
  clinicId: "c-akwa",
  phoneVerified: true,
  languages: [],
  permissions: {},
  landing: [],
};
const CLINICIAN: Me = { ...DESK, personId: "p-mbarga", givenName: "Esther", familyName: "Mbarga", roles: ["CLINICIAN"], staffId: "s-mbarga" };

function visit(id: string, hoursAhead: number, patient: string, state = "BOOKED", clinician = "s-mbarga") {
  return {
    appointmentId: id,
    reference: `APT-${id}`,
    clinicId: "c-akwa",
    patientProfileId: patient,
    appointmentTypeId: "at-follow",
    clinicianProfileId: clinician,
    startAt: at(hoursAhead),
    endAt: at(hoursAhead + 0.5),
    state,
    channel: "WEB",
    bookedByRole: "PATIENT",
    createdAt: at(-72),
    version: 1,
  };
}

// Mid-day ahead, so every visit falls on today's clinic date whatever the hour of the run.
const SCHEDULE = {
  appointments: [
    visit("b", 0.2, "pp-ama", "PATIENT_CANCELLED", "s-nkoulou"),
    visit("a", 0.1, "pp-brice"),
    visit("c", 0.3, "pp-unnamed"),
  ],
  patients: {
    "pp-ama": { givenName: "Ama", familyName: "Darko" },
    "pp-brice": { givenName: "Brice", familyName: "Tagne" },
    "pp-unnamed": { givenName: null, familyName: null },
  },
};

function respond(schedule: { appointments: unknown[]; patients: Record<string, unknown> } = SCHEDULE) {
  api.mockImplementation(async (path: string) => {
    if (path === "/clinicians") {
      return {
        clinicians: [
          { clinicianProfileId: "s-mbarga", clinicId: "c-akwa", givenName: "Esther", familyName: "Mbarga", specialty: "Paediatrics" },
          { clinicianProfileId: "s-nkoulou", clinicId: "c-akwa", givenName: "Jean-Paul", familyName: "Nkoulou", specialty: "Cardiology" },
        ],
      };
    }
    if (path === "/clinics") return { clinics: [{ clinicId: "c-akwa", name: "Clinique d'Akwa", address: null, phone: null, openingHours: null }] };
    if (path === "/appointment-types") return { appointmentTypes: [{ appointmentTypeId: "at-follow", name: "Follow-up consultation" }] };
    if (path.startsWith("/clinics/c-akwa/day") || path.startsWith("/clinicians/s-mbarga/calendar")) return schedule;
    throw new Error(`unexpected ${path}`);
  });
}

function Where() {
  const { pathname, search } = useLocation();
  return <span data-testid="where">{pathname + search}</span>;
}

function renderConsole(me: Me, path = "/console", audience: "staff" | "patient" = "staff") {
  const session = { state: { status: "signed-in", me, audience }, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {staffRoutes}
          <Route path="/home" element={<p>patient home</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("Day schedule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fr_stf_01: the front desk reads the clinic's day, with every patient named", async () => {
    respond();
    renderConsole(DESK);
    const list = await screen.findByRole("list", { name: "Appointments" });
    expect(api).toHaveBeenCalledWith(`/clinics/c-akwa/day?date=${today()}`);
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.querySelector(".day-name")?.textContent)).toEqual(["Brice Tagne", "Ama Darko", "Patient"]);
    expect(rows[0]).toHaveTextContent("Follow-up consultation · Dr Esther Mbarga");
    expect(rows[1]).toHaveTextContent("Cancelled by patient");
  });

  it("counts the day on its tiles", async () => {
    respond();
    renderConsole(DESK);
    const figures = await screen.findByRole("region", { name: "The day in figures" });
    await within(list()).findAllByRole("button");
    expect(figures).toHaveTextContent("2Booked today");
    expect(figures).toHaveTextContent("2Still to come");
    expect(figures).toHaveTextContent("1Cancelled today");
  });

  it("details the next visit still to come, and offers to cancel it", async () => {
    respond();
    renderConsole(DESK);
    const panel = await screen.findByRole("region", { name: "Selected visit" });
    expect(await within(panel).findByText("Brice Tagne")).toBeInTheDocument();
    const brice = SCHEDULE.appointments[1]!;
    expect(panel).toHaveTextContent(`${clock.time(brice.startAt)} to ${clock.time(brice.endAt)}`);
    expect(within(panel).getByRole("link", { name: "Open visit" })).toHaveAttribute("href", expect.stringContaining("/console/visits/a"));
    expect(within(panel).getByRole("button", { name: "Cancel this visit" })).toBeInTheDocument();
  });

  it("offers no cancel for a visit already cancelled", async () => {
    respond();
    renderConsole(DESK, "/console?visit=b");
    const panel = await screen.findByRole("region", { name: "Selected visit" });
    expect(await within(panel).findByText("Ama Darko")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Cancel this visit" })).not.toBeInTheDocument();
  });

  it("moves a day at a time, and back to today", async () => {
    respond();
    renderConsole(DESK);
    await screen.findByRole("list", { name: "Appointments" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(api).toHaveBeenCalledWith(`/clinics/c-akwa/day?date=${shiftDate(today(), 1)}`);
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/console$/);
  });

  it("fr_stf_01: a clinician reads their own calendar and not the clinic's day", async () => {
    respond();
    renderConsole(CLINICIAN);
    expect(await screen.findByRole("heading", { name: "Your day" })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(`/clinicians/s-mbarga/calendar?from=${today()}&to=${today()}`);
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining("/day?"));
    const rows = await within(list()).findAllByRole("button");
    expect(rows[0]).not.toHaveTextContent("Dr ");
  });

  it("says so when the day is empty", async () => {
    respond({ appointments: [], patients: {} });
    renderConsole(DESK);
    expect(await screen.findByText("Nothing booked on this day.")).toBeInTheDocument();
  });

  it("sends a patient to their own app", async () => {
    respond();
    renderConsole({ ...DESK, roles: ["PATIENT"], patientProfileId: "pp-1" }, "/console", "patient");
    expect(await screen.findByText("patient home")).toBeInTheDocument();
  });
});

function list() {
  return screen.getByRole("list", { name: "Appointments" });
}
