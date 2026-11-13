import { render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { PatientDataProvider } from "./data";
import en from "../i18n/locales/en/home.json";
import fr from "../i18n/locales/fr/home.json";
import pcm from "../i18n/locales/pcm/home.json";
import { PatientHome } from "./PatientHome";

/** An isolated instance with the real Home resources, so each test picks its language. */
async function instance(lng: "en" | "fr" | "pcm") {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: "en",
    ns: ["home"],
    defaultNS: "home",
    resources: { en: { home: en }, fr: { home: fr }, pcm: { home: pcm } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api, apiAll: (path: string) => api(path) }));

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
      return { clinics: [{ clinicId: "c-akwa", name: "Medical Outpatient Unit", address: "Buea", phone: null, openingHours: null }] };
    }
    return {
      gridUnitMinutes: 10,
      appointmentTypes: [
        { appointmentTypeId: "at-1", name: "First specialist consultation", serviceLine: "SPECIALIST", bookableBy: "BOTH" },
      ],
    };
  });
}

async function renderHome(lng: "en" | "fr" | "pcm" = "en") {
  const i18n = await instance(lng);
  const session = { state: { status: "signed-in", me: ME, audience: "patient" }, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <I18nextProvider i18n={i18n}>
      <SessionContext.Provider value={session as never}>
        <MemoryRouter initialEntries={["/home"]}>
          <PatientDataProvider>
            <Routes>
              <Route path="/home" element={<PatientHome />} />
            </Routes>
          </PatientDataProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </I18nextProvider>,
  );
}

describe("PatientHome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("greets the patient by name", async () => {
    respond([]);
    await renderHome();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/, Amina$/);
  });

  it("leads with the next visit, named from the directory", async () => {
    respond([visit()]);
    await renderHome();
    const hero = await screen.findByRole("region", { name: "Your next visit" });
    expect(hero).toHaveTextContent("Dr Esther Mbarga");
    expect(hero).toHaveTextContent("Paediatrics · Medical Outpatient Unit · First specialist consultation");
    expect(hero).toHaveTextContent("APT-4958");
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/visits/a-1?cancel=1");
    // Three days ahead is more than a day away, so a reminder is scheduled.
    expect(screen.getByText("Reminder scheduled")).toBeInTheDocument();
  });

  it("offers to find care when nothing is booked", async () => {
    respond([]);
    await renderHome();
    expect(await screen.findByText("Find a time that suits you.")).toBeInTheDocument();
    expect(screen.getByText("Nothing booked yet. Your visits will be listed here.")).toBeInTheDocument();
  });

  it("does not list a cancelled visit as upcoming", async () => {
    respond([visit({ state: "PATIENT_CANCELLED" })]);
    await renderHome();
    expect(await screen.findByText("Find a time that suits you.")).toBeInTheDocument();
    expect(screen.getByText("Visit cancelled")).toBeInTheDocument();
  });

  // NFR-L10N-01: every Home string is offered in English, French and Pidgin.
  it.each([
    ["en", "Your next visit", "Cancel", "Reminder scheduled", "Find a time that suits you."],
    ["fr", "Votre prochaine visite", "Annuler", "Rappel programmé", "Trouvez un créneau qui vous convient."],
    ["pcm", "Yu next visit", "Cancel", "Reminder don set", "Find time wey fit yu."],
  ] as const)("NFR-L10N-01 reads in %s", async (lng, heroLabel, cancel, reminder, empty) => {
    respond([visit()]);
    const view = await renderHome(lng);
    const hero = await screen.findByRole("region", { name: heroLabel });
    expect(hero).toHaveTextContent("Dr Esther Mbarga");
    expect(screen.getByRole("link", { name: cancel })).toHaveAttribute("href", "/visits/a-1?cancel=1");
    expect(screen.getByText(reminder)).toBeInTheDocument();
    view.unmount();
    respond([]);
    await renderHome(lng);
    expect(await screen.findByText(empty)).toBeInTheDocument();
  });

  it("NFR-L10N-01 names the visit state in French and keeps the clock as it is", async () => {
    respond([visit()]);
    await renderHome("fr");
    const hero = await screen.findByRole("region", { name: "Votre prochaine visite" });
    expect(hero).toHaveTextContent("PROCHAINE VISITE · CONFIRMÉ");
    expect(hero).toHaveTextContent("DANS");
    expect(hero).toHaveTextContent("APT-4958");
  });
});
