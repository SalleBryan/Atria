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

const DESK = {
  personId: "p-desk",
  givenName: "Nadine",
  familyName: "Fotso",
  tenantId: "t-1",
  roles: ["RECEPTIONIST"],
  patientProfileId: null,
  staffId: "s-desk",
  clinicId: "u-med",
} as unknown as Me;

const AMINA = {
  patientProfileId: "pp-1",
  givenName: "Amina",
  familyName: "Ngo",
  phoneE164: "+237691000001",
  patientNumber: "RHB-000001",
  dateOfBirth: "1990-05-02",
};

const TABI = {
  clinicianProfileId: "s-tabi",
  clinicId: "u-med",
  givenName: "Ernest",
  familyName: "Tabi",
  specialty: "Internal medicine",
  qualifications: [],
  registrationYear: 2010,
  seniorityBand: "EXPERIENCED",
  languages: ["en"],
};

const SPEC = {
  appointmentTypeId: "at-spec-first",
  code: "SPEC_FIRST",
  name: "First specialist consultation",
  serviceLine: "SPECIALIST",
  durationUnits: 3,
  bufferUnits: 1,
  bookableBy: "BOTH",
  minNoticeMinutes: 30,
  maxAdvanceDays: 60,
  cancellationWindowMinutes: 1440,
  clinicIds: ["u-med"],
};

const sent: { path: string; init?: { method?: string; json?: unknown } }[] = [];

function respond() {
  sent.length = 0;
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    sent.push({ path, init });
    if (path === "/clinicians") return { clinicians: [TABI] };
    if (path === "/clinics") return { clinics: [{ clinicId: "u-med", name: "Medical Unit" }] };
    if (path === "/appointment-types") return { appointmentTypes: [SPEC] };
    if (path.startsWith("/clinics/u-med/day")) return { appointments: [], patients: {} };
    if (path.startsWith("/patients?q=")) return { results: path.includes("ngo") ? [AMINA] : [] };
    if (path === "/patients/pp-1")
      return {
        ...AMINA,
        email: null,
        preferredLanguage: "fr",
        hasAccount: true,
        phoneVerified: true,
        emailVerified: false,
        source: "SELF",
        createdAt: null,
        visitScope: "clinic",
        appointments: [],
      };
    if (path.startsWith("/clinicians/s-tabi/slots")) {
      const from = new URL(path, "http://x").searchParams.get("from") ?? "";
      return { days: { [from]: [{ startAt: `${from}T09:00:00Z`, endAt: `${from}T09:30:00Z` }] } };
    }
    if (path === "/appointments" && init?.method === "POST") return { appointmentId: "a-9", reference: "APT-9" };
    if (path.startsWith("/appointments/a-9")) return null;
    if (path.startsWith("/clinics/u-med/roster"))
      return {
        clinicId: "u-med",
        date: "2026-09-28",
        onShift: 1,
        clinicians: [
          {
            ...TABI,
            status: "ON_SHIFT",
            startsAt: "07:30",
            endsAt: "15:30",
            timeOff: [],
            visits: 4,
            bookedMinutes: 120,
            workingMinutes: 480,
            load: 0.25,
          },
        ],
      };
    throw new Error(`unexpected ${path}`);
  });
}

function renderAt(path: string, me: Me = DESK) {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {staffRoutes}
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("The staff console", () => {
  beforeEach(respond);

  it("finds a patient in the register (FR-STF-06)", async () => {
    const user = userEvent.setup();
    renderAt("/console/patients");
    await user.type(screen.getByRole("textbox", { name: "Search patients" }), "ngo");
    const list = screen.getByRole("region", { name: "Patients found" });
    expect(await within(list).findByText("Amina Ngo")).toBeInTheDocument();
    expect(within(list).getByText("+237 6 91 00 00 01")).toBeInTheDocument();
    expect(within(list).getByText("RHB-000001")).toBeInTheDocument();
  });

  it("shows the record with contact and verification (FR-STF-07)", async () => {
    renderAt("/console/patients/pp-1");
    expect(await screen.findByRole("heading", { name: "Amina Ngo" })).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Visits in your unit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Book a visit/ })).toHaveAttribute("href", "/console/book?patient=pp-1");
  });

  it("books by phone with the callback number (FR-BKG-07, FR-STF-14)", async () => {
    const user = userEvent.setup();
    renderAt("/console/book?patient=pp-1&clinician=s-tabi");
    expect(await screen.findByText("Amina Ngo")).toBeInTheDocument();
    await user.click(await screen.findByRole("radio", { name: "10:00" }));
    await user.click(screen.getByRole("button", { name: /Book visit/ }));
    const booked = sent.find((s) => s.path === "/appointments");
    expect(booked?.init?.json).toMatchObject({
      patientProfileId: "pp-1",
      clinicianProfileId: "s-tabi",
      appointmentTypeId: "at-spec-first",
      channel: "PHONE",
      callbackPhone: "+237691000001",
    });
  });

  it("asks where a referral came from before it books (FR-STF-14)", async () => {
    const user = userEvent.setup();
    renderAt("/console/book?patient=pp-1&clinician=s-tabi");
    await screen.findByText("Amina Ngo");
    await user.click(screen.getByRole("radio", { name: "Referral" }));
    await user.click(await screen.findByRole("radio", { name: "10:00" }));
    expect(screen.getByRole("button", { name: /Book visit/ })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Referring facility" }), "Muea Health Centre");
    expect(screen.getByRole("button", { name: /Book visit/ })).toBeEnabled();
  });

  it("shows who is on shift and how full their day is (FR-STF-08)", async () => {
    renderAt("/console/roster");
    expect(await screen.findByText("On shift")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: /Tabi's day booked/ })).toHaveAttribute("aria-valuenow", "25");
  });

  it("puts Patients and Roster in the front desk's menu", async () => {
    renderAt("/console/patients");
    expect((await screen.findAllByRole("link", { name: "Patients" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Roster" }).length).toBeGreaterThan(0);
  });
});
