import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import i18n from "../i18n";
import { Account } from "./Account";
import { PatientDataProvider } from "./data";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
  // The screens read whole lists through apiAll, which calls api from inside its module; route it to the stub.
  apiAll: (path: string) => api(path),
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

function renderAccount(signOut = vi.fn(), me: Me = ME) {
  api.mockImplementation(async (path: string) => {
    if (path.startsWith("/patients/me/appointments")) {
      return {
        appointments: [
          {
            appointmentId: "a-1",
            reference: "APT-1",
            clinicId: "c-akwa",
            appointmentTypeId: "at-1",
            clinicianProfileId: "s-1",
            startAt: AHEAD,
            endAt: AHEAD,
            state: "BOOKED",
            createdAt: AHEAD,
          },
        ],
      };
    }
    if (path === "/clinicians") {
      return {
        clinicians: [
          {
            clinicianProfileId: "s-1",
            clinicId: "c-akwa",
            givenName: "Esther",
            familyName: "Mbarga",
            specialty: "Paediatrics",
            languages: [],
            qualifications: [],
            registrationYear: 2008,
            seniorityBand: "EXPERIENCED",
          },
        ],
      };
    }
    if (path === "/clinics") {
      return {
        clinics: [
          {
            clinicId: "c-akwa",
            name: "Medical Outpatient Unit",
            address: "Buea",
            phone: null,
            openingHours: { "0": { start: "08:00", end: "17:00" } },
          },
        ],
      };
    }
    return { gridUnitMinutes: 10, appointmentTypes: [] };
  });
  const session = { state: { status: "signed-in", me, audience: "patient" }, refresh: vi.fn(), signOut };
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
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  it("shows what Atria holds, with the mobile masked and its verification", async () => {
    renderAccount();
    expect(await screen.findByRole("heading", { name: "Personal details" })).toBeInTheDocument();
    expect(screen.getAllByText("amina@example.com").length).toBeGreaterThan(0);
    expect(screen.queryByText("+12025550142")).not.toBeInTheDocument();
    expect(screen.getByText(/not verified yet/)).toBeInTheDocument();
    // The email is how the account signs in: shown, never changed here.
    expect(screen.queryByRole("button", { name: "Change your email" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change your mobile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change your date of birth" })).toBeInTheDocument();
  });

  it("previews the reminder in the words the SMS really uses", async () => {
    renderAccount();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Notifications/ }));
    expect(
      await screen.findByText(
        /^Atria reminder: appointment \d{2}\/\d{2}\/\d{4} at \d{2}:\d{2}, Medical Outpatient Unit, Esther Mbarga\. Ref APT-1\. To cancel: Atria app\.$/,
      ),
    ).toBeInTheDocument();
  });

  it("lists the units with their hours", async () => {
    renderAccount();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Units/ }));
    expect(await screen.findByText("08:00 to 17:00")).toBeInTheDocument();
    expect(screen.getAllByText("Closed").length).toBe(6);
  });

  it("signs out of this device", async () => {
    const signOut = renderAccount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await user.click(screen.getByRole("menuitem", { name: /This device/ }));
    expect(signOut).toHaveBeenCalledWith({ everywhere: false });
  });

  it("signs out of every device (FR-ACC-12)", async () => {
    const signOut = renderAccount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await user.click(screen.getByRole("menuitem", { name: /All devices/ }));
    expect(signOut).toHaveBeenCalledWith({ everywhere: true });
  });

  // NFR-L10N-01: the screen speaks the chosen language; NFR-L10N-02: dates follow it.
  it.each([
    ["fr", "Informations personnelles", "pas encore vérifié", "Modifier votre mobile", "02/04/1990", /^Rappel Atria: RDV le \d{2}\/\d{2}\/\d{4} a \d{2}:\d{2}, Medical Outpatient Unit, Esther Mbarga\. Ref APT-1\. Pour annuler: application Atria\.$/],
    ["pcm", "Yu details", "dem no don verify am yet", "Change yu mobile", "02 April 1990", /^Atria reminder: appointment \d{2}\/\d{2}\/\d{4} fo \d{2}:\d{2}, Medical Outpatient Unit, Esther Mbarga\. Ref APT-1\. Fo cancel: Atria app\.$/],
    ["en", "Personal details", "not verified yet", "Change your mobile", "02 April 1990", /^Atria reminder: appointment \d{2}\/\d{2}\/\d{4} at \d{2}:\d{2}, Medical Outpatient Unit, Esther Mbarga\. Ref APT-1\. To cancel: Atria app\.$/],
  ])("shows the details and the SMS preview in %s (NFR-L10N-01)", async (lng, heading, unverified, change, born, sms) => {
    await i18n.changeLanguage(lng);
    renderAccount(vi.fn(), { ...ME, dateOfBirth: "1990-04-02" } as Me);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(unverified))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: change })).toBeInTheDocument();
    expect(screen.getByText(born)).toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole("button", { name: /Notifications/ })[0] as HTMLElement);
    expect(await screen.findByText(sms)).toBeInTheDocument();
  });

  it("offers the three languages (NFR-L10N-01)", async () => {
    renderAccount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Language/ }));
    for (const name of ["English", "Français", "Pidgin"]) expect(screen.getByRole("option", { name })).toBeInTheDocument();
  });
});
