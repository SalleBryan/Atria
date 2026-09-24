import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { Account } from "./Account";
import { PatientDataProvider } from "./data";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

const ME = {
  personId: "p-1",
  givenName: "Amina",
  familyName: "Ngo",
  email: "amina@example.com",
  phoneE164: "+12025550142",
  phoneVerified: false,
  patientProfileId: "pp-1",
} as Me;

const AHEAD = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

function renderAccount(signOut = vi.fn()) {
  api.mockImplementation(async (path: string) => {
    if (path.startsWith("/patients/me/appointments")) {
      return {
        appointments: [
          { appointmentId: "a-1", reference: "APT-1", clinicId: "c-akwa", appointmentTypeId: "at-1", clinicianProfileId: "s-1", startAt: AHEAD, endAt: AHEAD, state: "BOOKED", createdAt: AHEAD },
        ],
      };
    }
    if (path === "/clinicians") {
      return { clinicians: [{ clinicianProfileId: "s-1", clinicId: "c-akwa", givenName: "Esther", familyName: "Mbarga", specialty: "Paediatrics", languages: [], qualifications: [], registrationYear: 2008, seniorityBand: "EXPERIENCED" }] };
    }
    if (path === "/clinics") {
      return { clinics: [{ clinicId: "c-akwa", name: "Clinique d'Akwa", address: "Douala", phone: null, openingHours: { "0": { start: "08:00", end: "17:00" } } }] };
    }
    return { gridUnitMinutes: 10, appointmentTypes: [] };
  });
  const session = { state: { status: "signed-in", me: ME, audience: "patient" }, refresh: vi.fn(), signOut };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter>
        <PatientDataProvider>
          <Account />
        </PatientDataProvider>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
  return signOut;
}

describe("Account", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows what Atria holds, with the mobile masked and its verification", async () => {
    renderAccount();
    expect(await screen.findByRole("heading", { name: "Personal details" })).toBeInTheDocument();
    expect(screen.getAllByText("amina@example.com").length).toBeGreaterThan(0);
    expect(screen.queryByText("+12025550142")).not.toBeInTheDocument();
    expect(screen.getByText("Not verified yet")).toBeInTheDocument();
  });

  it("previews the reminder in the words the SMS really uses", async () => {
    renderAccount();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText(/^Rappel Atria: RDV le .* Clinique d'Akwa, Dr Esther Mbarga\. Ref APT-1\. Pour annuler: application Atria\.$/)).toBeInTheDocument();
  });

  it("lists the clinics with their hours", async () => {
    renderAccount();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Clinics/ }));
    expect(await screen.findByText("08:00 to 17:00")).toBeInTheDocument();
    expect(screen.getAllByText("Closed").length).toBe(6);
  });

  it("signs out", async () => {
    const signOut = renderAccount();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
  });
});
