import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { PatientDataProvider } from "./data";
import { PatientHome } from "./PatientHome";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api }));

const ME = { personId: "p-1", givenName: "Amina", familyName: "Ngo", patientProfileId: "pp-1" } as Me;
const AHEAD = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

const MBARGA = {
  clinicianProfileId: "s-mbarga",
  clinicId: "c-akwa",
  givenName: "Esther",
  familyName: "Mbarga",
  specialty: "Paediatrics",
  languages: [],
  qualifications: [],
  registrationYear: 2008,
  seniorityBand: "EXPERIENCED",
};

function visit(overrides: Record<string, unknown> = {}) {
  return {
    appointmentId: "a-1",
    reference: "APT-4958",
    clinicId: "c-akwa",
    appointmentTypeId: "at-1",
    clinicianProfileId: "s-mbarga",
    startAt: AHEAD,
    endAt: AHEAD,
    state: "BOOKED",
    createdAt: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

function respond(appointments: unknown[]) {
  api.mockImplementation(async (path: string) => {
    if (path.startsWith("/patients/me/appointments")) return { appointments };
    if (path === "/clinicians") return { clinicians: [MBARGA] };
    if (path === "/clinics") {
      return { clinics: [{ clinicId: "c-akwa", name: "Clinique d'Akwa", address: "Douala", phone: null, openingHours: null }] };
    }
    return {
      gridUnitMinutes: 10,
      appointmentTypes: [
        { appointmentTypeId: "at-1", name: "First specialist consultation", serviceLine: "SPECIALIST", bookableBy: "BOTH" },
      ],
    };
  });
}

function renderHome() {
  const session = { state: { status: "signed-in", me: ME, audience: "patient" }, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={["/home"]}>
        <PatientDataProvider>
          <Routes>
            <Route path="/home" element={<PatientHome />} />
          </Routes>
        </PatientDataProvider>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("PatientHome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("greets the patient by name", async () => {
    respond([]);
    renderHome();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/, Amina$/);
  });

  it("leads with the next visit, named from the directory", async () => {
    respond([visit()]);
    renderHome();
    const hero = await screen.findByRole("region", { name: "Your next visit" });
    expect(hero).toHaveTextContent("Dr Esther Mbarga");
    expect(hero).toHaveTextContent("Paediatrics · Clinique d'Akwa · First specialist consultation");
    expect(hero).toHaveTextContent("APT-4958");
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/visits/a-1?cancel=1");
    // Three days ahead is more than a day away, so a reminder is scheduled.
    expect(screen.getByText("Reminder scheduled")).toBeInTheDocument();
  });

  it("offers to find care when nothing is booked", async () => {
    respond([]);
    renderHome();
    expect(await screen.findByText("Find a time that suits you.")).toBeInTheDocument();
    expect(screen.getByText("Nothing booked yet. Your visits will be listed here.")).toBeInTheDocument();
  });

  it("does not list a cancelled visit as upcoming", async () => {
    respond([visit({ state: "PATIENT_CANCELLED" })]);
    renderHome();
    expect(await screen.findByText("Find a time that suits you.")).toBeInTheDocument();
    expect(screen.getByText("Visit cancelled")).toBeInTheDocument();
  });
});
