import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { type Appointment, PatientDataProvider } from "./data";
import { TicketDetail } from "./QueueVisit";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api, apiAll: (path: string) => api(path) }));

const ME = { personId: "p-1", givenName: "Amina", familyName: "Ngo", patientProfileId: "pp-1" } as Me;

const TICKET = {
  appointmentId: "a-9",
  reference: "APT-9",
  clinicId: "c-akwa",
  appointmentTypeId: "at-gen",
  sessionId: "s-1",
  position: 4,
  createdAt: "2026-11-12T10:00:00Z",
  startAt: "2026-11-13T08:00:00Z",
  endAt: "2026-11-13T08:30:00Z",
  arrivalWindowStart: "2026-11-13T07:50:00Z",
  arrivalWindowEnd: "2026-11-13T08:20:00Z",
  state: "CONFIRMED",
} as unknown as Appointment;

function respond(outlook: unknown | "fail") {
  api.mockImplementation(async (path: string) => {
    if (path.startsWith("/patients/me/appointments")) return { appointments: [TICKET] };
    if (path === "/clinicians") return { clinicians: [] };
    if (path === "/clinics") return { clinics: [{ clinicId: "c-akwa", name: "Medical Outpatient Unit", address: "Buea" }] };
    if (path === "/sessions/s-1") {
      return { sessionId: "s-1", issuedTickets: 9, partOfDay: "MORNING", status: "OPEN", startTime: "08:00", endTime: "12:00" };
    }
    if (path === "/appointments/a-9/ticket") {
      if (outlook === "fail") throw new Error("offline");
      return outlook;
    }
    return {
      gridUnitMinutes: 10,
      appointmentTypes: [{ appointmentTypeId: "at-gen", name: "General consultation", serviceLine: "GENERAL" }],
    };
  });
}

function renderTicket(appointment: Appointment = TICKET) {
  const session = { state: { status: "signed-in", me: ME, audience: "patient" }, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter>
        <PatientDataProvider>
          <TicketDetail appointment={appointment} actions={null} />
        </PatientDataProvider>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("TicketDetail, the live place", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says how many are ahead and when the patient is likely to be seen", async () => {
    respond({ ahead: 3, expectedStartAt: "2026-11-13T08:45:00Z", next: false });
    renderTicket();
    expect(await screen.findByText("3 patients")).toBeInTheDocument();
    expect(screen.getByText(/Likely to be seen around/)).toBeInTheDocument();
    expect(screen.getByText(/an estimate that updates here/)).toBeInTheDocument();
  });

  it("says so when the patient is next", async () => {
    respond({ ahead: 0, expectedStartAt: "2026-11-13T08:15:00Z", next: true });
    renderTicket({ ...TICKET, state: "ARRIVED" } as Appointment);
    expect(await screen.findByText("No one, you are next")).toBeInTheDocument();
  });

  it("keeps the static place when the live read fails", async () => {
    respond("fail");
    renderTicket();
    expect(await screen.findByText("4 of 9")).toBeInTheDocument();
    expect(screen.queryByText("Ahead of you")).not.toBeInTheDocument();
  });

  it("does not read the live place of a ticket that is no longer waiting", async () => {
    respond({ ahead: 1, expectedStartAt: "2026-11-13T08:45:00Z", next: false });
    renderTicket({ ...TICKET, state: "PATIENT_CANCELLED" } as Appointment);
    expect(await screen.findByText("This booking")).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith("/appointments/a-9/ticket");
  });
});

describe("TicketDetail on a bad connection (audit F16)", () => {
  const online = vi.spyOn(window.navigator, "onLine", "get");
  beforeEach(() => {
    vi.clearAllMocks();
    online.mockReturnValue(true);
  });

  it("keeps the last place and says it may be out of date when a refresh fails", async () => {
    respond({ ahead: 3, expectedStartAt: "2026-11-13T08:45:00Z", next: false });
    renderTicket();
    expect(await screen.findByText("3 patients")).toBeInTheDocument();
    expect(screen.queryByText(/could not refresh your place/)).not.toBeInTheDocument();

    respond("fail");
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByText(/could not refresh your place/)).toBeInTheDocument();
    expect(screen.getByText(/may have changed/)).toBeInTheDocument();
    expect(screen.getByText("3 patients")).toBeInTheDocument();
  });

  it("does not read the live place at all while the device is offline, and reads at once when it is back", async () => {
    online.mockReturnValue(false);
    respond({ ahead: 2, expectedStartAt: "2026-11-13T08:45:00Z", next: false });
    renderTicket();
    expect(await screen.findByText("4 of 9")).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith("/appointments/a-9/ticket");

    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByText("2 patients")).toBeInTheDocument();
  });
});

describe("TicketDetail, an early-call invitation", () => {
  beforeEach(() => vi.clearAllMocks());

  const OPEN = { status: "open", expiresAt: "2026-11-13T08:10:00Z", answer: null, eta: null };

  function withReply(reply: unknown | "fail") {
    const base = api.getMockImplementation() as (path: string, options?: unknown) => Promise<unknown>;
    api.mockImplementation(async (path: string, options?: unknown) => {
      if (path === "/appointments/a-9/invite-reply") {
        if (reply === "fail") throw new Error("offline");
        return reply;
      }
      return base(path, options);
    });
  }

  it("asks whether the patient can come sooner and says the place does not change", async () => {
    respond({ ahead: 3, expectedStartAt: "2026-11-13T08:45:00Z", next: false, invite: OPEN });
    renderTicket();
    expect(await screen.findByText(/A doctor is free sooner/)).toBeInTheDocument();
    expect(screen.getByText(/Your place does not change whatever you answer/)).toBeInTheDocument();
  });

  it("sends YES and then says when they are expected", async () => {
    respond({ ahead: 3, expectedStartAt: "2026-11-13T08:45:00Z", next: false, invite: OPEN });
    withReply({ invite: { ...OPEN, status: "accepted", answer: "YES", eta: "2026-11-13T08:10:00Z" } });
    renderTicket();
    fireEvent.click(await screen.findByRole("button", { name: /Yes, I am coming/ }));
    expect(await screen.findByText(/We expect you by/)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("/appointments/a-9/invite-reply", { method: "POST", json: { answer: "YES" } });
  });

  it("sends NO and keeps the place", async () => {
    respond({ ahead: 3, expectedStartAt: "2026-11-13T08:45:00Z", next: false, invite: OPEN });
    withReply({ invite: { ...OPEN, status: "declined", answer: "NO" } });
    renderTicket();
    fireEvent.click(await screen.findByRole("button", { name: /No, keep my place/ }));
    expect(await screen.findByText(/Your place is unchanged/)).toBeInTheDocument();
  });

  it("says so when the answer did not go through, and offers it again", async () => {
    respond({ ahead: 3, expectedStartAt: "2026-11-13T08:45:00Z", next: false, invite: OPEN });
    withReply("fail");
    renderTicket();
    fireEvent.click(await screen.findByRole("button", { name: /Yes, I am coming/ }));
    expect(await screen.findByText(/That did not go through/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yes, I am coming/ })).toBeEnabled();
  });

  it("shows nothing once the invitation has run out", async () => {
    respond({ ahead: 3, expectedStartAt: "2026-11-13T08:45:00Z", next: false, invite: { ...OPEN, status: "expired" } });
    renderTicket();
    expect(await screen.findByText("3 patients")).toBeInTheDocument();
    expect(screen.queryByText(/A doctor is free sooner/)).not.toBeInTheDocument();
  });
});
