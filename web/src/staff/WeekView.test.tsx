import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, useLocation } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { mondayOf, shiftDate, today } from "./data";
import { staffRoutes } from "./routes";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

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
const CLINICIAN = { ...DESK, roles: ["CLINICIAN"], staffId: "s-mbarga" } as Me;

const MONDAY = mondayOf(today());

/** A visit at a clinic-local time on a day of this week (0 is Monday). */
function visit(id: string, day: number, hour: number, clinician: string, state = "BOOKED") {
  const start = new Date(`${shiftDate(MONDAY, day)}T${String(hour).padStart(2, "0")}:00:00+01:00`);
  return {
    appointmentId: id,
    reference: `APT-${id}`,
    clinicId: "c-akwa",
    patientProfileId: `pp-${id}`,
    appointmentTypeId: "at-follow",
    clinicianProfileId: clinician,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 30 * 60000).toISOString(),
    state,
    channel: "WEB",
    bookedByRole: null,
    createdAt: "2026-01-01T09:00:00Z",
    version: 1,
  };
}

const WEEK = [
  visit("a", 0, 9, "s-mbarga"),
  visit("b", 2, 11, "s-nkoulou"),
  visit("c", 2, 11, "s-mbarga"),
  visit("d", 4, 14, "s-nkoulou", "CLINIC_CANCELLED"),
];
const NAMES = Object.fromEntries(WEEK.map((a) => [a.patientProfileId, { givenName: "Patient", familyName: a.appointmentId.toUpperCase() }]));

function respond() {
  api.mockImplementation(async (path: string) => {
    if (path === "/clinicians") {
      return {
        clinicians: [
          { clinicianProfileId: "s-mbarga", clinicId: "c-akwa", givenName: "Esther", familyName: "Mbarga" },
          { clinicianProfileId: "s-nkoulou", clinicId: "c-akwa", givenName: "Jean-Paul", familyName: "Nkoulou" },
        ],
      };
    }
    if (path === "/clinics") {
      const hours = Object.fromEntries([0, 1, 2, 3, 4].map((d) => [String(d), { start: "08:00", end: "17:00" }]));
      return { clinics: [{ clinicId: "c-akwa", name: "Clinique d'Akwa", openingHours: hours }] };
    }
    if (path === "/appointment-types") return { appointmentTypes: [] };
    const day = path.match(/^\/clinics\/c-akwa\/day\?date=(.+)$/);
    if (day) {
      const found = WEEK.filter((a) => a.startAt.startsWith(day[1]!) || new Date(Date.parse(a.startAt) + 3600000).toISOString().startsWith(day[1]!));
      return { appointments: found, patients: NAMES };
    }
    if (path.startsWith("/clinicians/s-mbarga/calendar")) {
      return { appointments: WEEK.filter((a) => a.clinicianProfileId === "s-mbarga"), patients: NAMES };
    }
    throw new Error(`unexpected ${path}`);
  });
}

function Where() {
  const { pathname } = useLocation();
  return <span data-testid="where">{pathname}</span>;
}

function renderWeek(me: Me, path = "/console/week") {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{staffRoutes}</Routes>
        <Where />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

const blocks = () => screen.getByRole("region", { name: "The week" }).querySelectorAll(".week-block");

describe("Week view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fr_stf_01: the front desk's week is the clinic's seven days", async () => {
    respond();
    renderWeek(DESK);
    expect(await screen.findByRole("button", { name: /Patient A/ })).toBeInTheDocument();
    for (let day = 0; day < 7; day += 1) {
      expect(api).toHaveBeenCalledWith(`/clinics/c-akwa/day?date=${shiftDate(MONDAY, day)}`);
    }
    expect(blocks()).toHaveLength(4);
  });

  it("sets two visits at the same time side by side", async () => {
    respond();
    renderWeek(DESK);
    const b = await screen.findByRole("button", { name: /Patient B/ });
    const c = screen.getByRole("button", { name: /Patient C/ });
    expect(b.style.width).toContain("50%");
    expect(b.style.left).not.toEqual(c.style.left);
  });

  it("narrows to one clinician, and counts only theirs", async () => {
    respond();
    renderWeek(DESK);
    await screen.findByRole("button", { name: /Patient A/ });
    await userEvent.setup().click(screen.getByRole("radio", { name: "Dr Esther Mbarga" }));
    expect(blocks()).toHaveLength(2);
    expect(screen.getByRole("complementary", { name: "Week at a glance" })).toHaveTextContent("2Appointments booked");
  });

  it("counts the week on the side, cancellations apart", async () => {
    respond();
    renderWeek(DESK);
    const side = await screen.findByRole("complementary", { name: "Week at a glance" });
    await screen.findByRole("button", { name: /Patient A/ });
    expect(side).toHaveTextContent("3Appointments booked");
    expect(side).toHaveTextContent("1Cancelled this week");
  });

  it("opens a visit from its block", async () => {
    respond();
    renderWeek(DESK);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Patient A/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/console/visits/a");
  });

  it("fr_stf_01: a clinician's week is their own calendar, with nothing to filter", async () => {
    respond();
    renderWeek(CLINICIAN);
    expect(await screen.findByRole("button", { name: /Patient A/ })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(`/clinicians/s-mbarga/calendar?from=${MONDAY}&to=${shiftDate(MONDAY, 6)}`);
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining("/day?"));
    expect(screen.queryByRole("radiogroup", { name: "Clinician" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Week at a glance" })).getByText("Your load")).toBeInTheDocument();
  });
});
