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

const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);

const GP = {
  personId: "p-gp",
  givenName: "Walters",
  familyName: "Mbua",
  tenantId: "t-1",
  roles: ["CLINICIAN"],
  patientProfileId: null,
  staffId: "s-gp",
  clinicId: "u-opd",
} as unknown as Me;
const SURGEON = { ...GP, staffId: "s-surg", clinicId: "u-surg", personId: "p-surg" } as unknown as Me;

const SESSION = {
  sessionId: "se-1",
  clinicId: "u-opd",
  sessionDate: today,
  startTime: "07:30",
  endTime: "12:00",
  rosteredClinicianCount: 2,
  expectedThroughputPerHour: "4",
  actualThroughputPerHour: null,
  capacity: 36,
  issuedTickets: 2,
  remaining: 34,
  partOfDay: "MORNING",
  status: "RUNNING",
};

function ticket(n: number, state: string) {
  return {
    appointmentId: `a-${n}`,
    reference: `APT-${n}`,
    clinicId: "u-opd",
    patientProfileId: `pp-${n}`,
    appointmentTypeId: "at-gen",
    clinicianProfileId: null,
    sessionId: "se-1",
    position: n,
    startAt: `${today}T07:00:00Z`,
    endAt: `${today}T07:30:00Z`,
    arrivalWindowStart: `${today}T07:00:00Z`,
    arrivalWindowEnd: `${today}T07:30:00Z`,
    state,
    channel: "ONLINE",
    bookedByRole: null,
    createdAt: `${today}T05:00:00Z`,
    version: 1,
  };
}

const sent: { path: string; init?: { method?: string; json?: unknown } }[] = [];

function respond() {
  sent.length = 0;
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    sent.push({ path, init });
    if (path === "/clinicians")
      return {
        clinicians: [
          {
            clinicianProfileId: "s-surg",
            clinicId: "u-surg",
            givenName: "Emmanuel",
            familyName: "Ekane",
            specialty: "General surgery",
            languages: [],
          },
        ],
      };
    if (path === "/clinics")
      return {
        clinics: [
          { clinicId: "u-opd", name: "General Outpatient Department" },
          { clinicId: "u-surg", name: "Surgical Unit" },
        ],
      };
    if (path === "/appointment-types")
      return {
        appointmentTypes: [
          {
            appointmentTypeId: "at-gen",
            name: "General consultation",
            serviceLine: "GENERAL",
            durationUnits: null,
            clinicIds: ["u-opd"],
            bookableBy: "BOTH",
          },
          {
            appointmentTypeId: "at-minor",
            name: "Minor procedure",
            serviceLine: "PROCEDURE",
            durationUnits: 6,
            clinicIds: ["u-surg"],
            bookableBy: "STAFF",
            patientRequestable: true,
          },
        ],
      };
    if (path.startsWith("/clinics/") && path.includes("/day")) return { appointments: [], patients: {} };
    if (path === "/clinics/u-opd/sessions") return { sessions: [SESSION] };
    if (path === "/sessions/se-1/queue")
      return {
        ...SESSION,
        appointments: [ticket(1, "ARRIVED"), ticket(2, "BOOKED")],
        patients: { "pp-1": { givenName: "Brice", familyName: "Tagne" }, "pp-2": { givenName: "Chantal", familyName: "Ekambi" } },
        waiting: 1,
        arrived: 1,
        inConsultation: 0,
        seen: 0,
        plannedPerHour: 8,
        actualPerHour: null,
      };
    if (path === "/sessions/se-1/next") return ticket(1, "IN_CONSULTATION");
    if (path === "/clinics/u-surg/requests")
      return {
        count: 1,
        appointments: [
          { ...ticket(9, "REQUESTED"), clinicId: "u-surg", sessionId: null, appointmentTypeId: "at-minor", requestNote: "A cyst" },
        ],
        patients: { "pp-9": { givenName: "Herve", familyName: "Kamga" } },
      };
    if (path.endsWith("/decline")) return {};
    throw new Error(`unexpected ${path}`);
  });
}

function renderAt(path: string, me: Me) {
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

describe("The queue and requests", () => {
  beforeEach(respond);

  it("shows the live queue in position order (FR-BKG-13)", async () => {
    renderAt("/console/queue", GP);
    const list = await screen.findByRole("region", { name: "Today's queue" });
    expect(await within(list).findByText("Brice Tagne")).toBeInTheDocument();
    expect(within(list).getAllByText("Arrived").length).toBeGreaterThan(0);
    expect(within(list).getAllByText("Waiting").length).toBeGreaterThan(0);
  });

  it("lets a doctor call their next patient", async () => {
    const user = userEvent.setup();
    renderAt("/console/queue", GP);
    await user.click(await screen.findByRole("button", { name: "Call my next patient" }));
    expect(sent.some((s) => s.path === "/sessions/se-1/next" && s.init?.method === "POST")).toBe(true);
  });

  it("puts Queue in the outpatient department's menu only", async () => {
    renderAt("/console/queue", GP);
    expect((await screen.findAllByRole("link", { name: "Queue" })).length).toBeGreaterThan(0);
  });

  it("lists requests and declines one with a reason (FR-STF-15)", async () => {
    const user = userEvent.setup();
    renderAt("/console/requests", SURGEON);
    expect(await screen.findByText("Herve Kamga")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Decline" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Decline" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Needs a surgical review first");
    await user.click(within(dialog).getByRole("button", { name: "Decline" }));
    const declined = sent.find((s) => s.path.endsWith("/decline"));
    expect(declined?.init?.json).toEqual({ reason: "Needs a surgical review first" });
  });
});
