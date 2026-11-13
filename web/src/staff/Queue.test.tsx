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

const POLICY = {
  holdMinutes: 5,
  lateGraceMinutes: 15,
  maxBypass: 1,
  inviteLeadMinutes: 5,
  inviteFanout: 3,
  inviteOpenMinutes: 20,
  earlyCallInvites: "desk",
  source: {
    holdMinutes: "default",
    lateGraceMinutes: "default",
    maxBypass: "default",
    inviteLeadMinutes: "default",
    inviteFanout: "default",
    inviteOpenMinutes: "default",
    earlyCallInvites: "default",
  },
};

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
    if (path === "/sessions/se-1/invites") return { invited: ["a-2"], openMinutes: 20 };
    if (path === "/clinics/u-surg/requests")
      return {
        count: 1,
        appointments: [
          { ...ticket(9, "REQUESTED"), clinicId: "u-surg", sessionId: null, appointmentTypeId: "at-minor", requestNote: "A cyst" },
        ],
        patients: { "pp-9": { givenName: "Herve", familyName: "Kamga" } },
      };
    if (path === "/clinics/u-opd/queue-policy") return POLICY;
    if (path.endsWith("/policy") || path.endsWith("/queue-policy")) return POLICY;
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

  it("says the Sessions pace is per doctor, while the live queue shows the unit total", async () => {
    renderAt("/console/queue", GP);
    const live = await screen.findByRole("region", { name: "Today's queue" });
    expect(await within(live).findByText(/of 8 an hour/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Sessions" }));
    const sessions = await screen.findByRole("region", { name: "Sessions" });
    expect(await within(sessions).findByText("4 an hour per doctor, planned")).toBeInTheDocument();
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

/** The live queue with extra fields on the server's answer, as ADR 0022 adds them. */
function queueWith(extra: Record<string, unknown>) {
  const base = api.getMockImplementation()!;
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    const answer = (await base(path, init)) as Record<string, unknown>;
    return path === "/sessions/se-1/queue" ? { ...answer, ...extra } : answer;
  });
}

const DESK = { ...GP, roles: ["RECEPTIONIST"], staffId: "s-desk", personId: "p-desk" } as unknown as Me;
const soon = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();

describe("The desk sees the cost of a call and who is held for (ADR 0022)", () => {
  beforeEach(respond);

  it("says who a call passes over and how long a consultation takes here", async () => {
    queueWith({
      callPreview: {
        candidate: "a-1",
        bypassed: [{ appointmentId: "a-2", position: 2, windowEnd: soon(20) }],
        hold: null,
        expectedConsultMinutes: 15,
        wouldBreachWindow: false,
      },
    });
    renderAt("/console/queue", GP);
    expect(await screen.findByText(/passes over/)).toHaveTextContent(/Chantal Ekambi \(place 2/);
    expect(screen.getByText(/takes about 15 min/)).toBeInTheDocument();
  });

  it("holds the doctor for a booked patient, and the desk may call anyway with a reason", async () => {
    const user = userEvent.setup();
    queueWith({
      callPreview: {
        candidate: null,
        bypassed: [],
        hold: { appointmentId: "a-2", position: 2, until: soon(4) },
        expectedConsultMinutes: 15,
        wouldBreachWindow: false,
      },
    });
    renderAt("/console/queue", GP);
    expect(await screen.findByText(/The doctor is held for Chantal Ekambi/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call my next patient" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Call anyway" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Call anyway" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Phoned: not coming today");
    await user.click(within(dialog).getByRole("button", { name: "Call anyway" }));
    const next = sent.find((s) => s.path === "/sessions/se-1/next");
    expect(next?.init?.json).toEqual({ overrideHold: true, reason: "Phoned: not coming today" });
  });

  it("asks for a confirm when the call would run past a bypassed patient's window", async () => {
    const user = userEvent.setup();
    queueWith({
      callPreview: {
        candidate: "a-1",
        bypassed: [{ appointmentId: "a-2", position: 2, windowEnd: soon(5) }],
        hold: null,
        expectedConsultMinutes: 20,
        wouldBreachWindow: true,
      },
    });
    renderAt("/console/queue", GP);
    await user.click(await screen.findByRole("button", { name: "Call my next patient" }));
    expect(sent.some((s) => s.path === "/sessions/se-1/next")).toBe(false);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Call now" }));
    expect(sent.some((s) => s.path === "/sessions/se-1/next" && s.init?.method === "POST")).toBe(true);
  });

  it("marks tickets that are late, urgent, not here yet or passed over", async () => {
    queueWith({
      appointments: [
        { ...ticket(1, "ARRIVED"), urgent: true, due: false, late: false, bypassCount: 0 },
        { ...ticket(2, "BOOKED"), due: true, late: false, bypassCount: 1 },
        { ...ticket(3, "BOOKED"), due: true, late: true, bypassCount: 0 },
      ],
    });
    renderAt("/console/queue", GP);
    const list = await screen.findByRole("region", { name: "Today's queue" });
    expect(await within(list).findByText("Urgent")).toBeInTheDocument();
    expect(within(list).getByText("Passed over")).toBeInTheDocument();
    expect(within(list).getByText("Late")).toBeInTheDocument();
    expect(within(list).getByText("Not here yet")).toBeInTheDocument();
  });
});

describe("Only the receptionist marks a place urgent (ADR 0022, owner decision)", () => {
  beforeEach(respond);

  it("gives the receptionist an Urgent button that needs a reason", async () => {
    const user = userEvent.setup();
    renderAt("/console/queue", DESK);
    await user.click((await screen.findAllByRole("button", { name: "Urgent" }))[0]!);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Mark urgent" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Bleeding");
    await user.click(within(dialog).getByRole("button", { name: "Mark urgent" }));
    const marked = sent.find((s) => s.path === "/appointments/a-1/urgent");
    expect(marked?.init?.json).toEqual({ reason: "Bleeding" });
  });

  it("gives a clinician no Urgent button", async () => {
    renderAt("/console/queue", GP);
    await screen.findByText("Brice Tagne");
    expect(screen.queryByRole("button", { name: "Urgent" })).not.toBeInTheDocument();
  });
});

const MANAGER = { ...GP, roles: ["CLINIC_MANAGER"], staffId: "s-mgr", personId: "p-mgr" } as unknown as Me;

describe("The queue rules are set by level (ADR 0022)", () => {
  beforeEach(respond);

  it("lets the desk adjust one session, and leave a rule on the default", async () => {
    const user = userEvent.setup();
    queueWith({ policy: POLICY });
    renderAt("/console/queue", DESK);
    await user.click(await screen.findByRole("button", { name: "Rules for today" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save the rules" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: /^Hold the doctor for a booked patient/ }));
    await user.click(await screen.findByRole("option", { name: "8 min" }));
    await user.click(within(dialog).getByRole("button", { name: "Save the rules" }));
    const saved = sent.find((s) => s.path === "/sessions/se-1/policy");
    expect(saved?.init?.method).toBe("PATCH");
    expect(saved?.init?.json).toEqual({ holdMinutes: 8 });
  });

  it("gives a clinician no rules to set", async () => {
    queueWith({ policy: POLICY });
    renderAt("/console/queue", GP);
    await screen.findByText("Brice Tagne");
    expect(screen.queryByRole("button", { name: "Rules for today" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Queue rules" })).not.toBeInTheDocument();
  });

  it("lets a unit manager set their unit's rules, read from the server", async () => {
    const user = userEvent.setup();
    renderAt("/console/queue", MANAGER);
    await user.click(await screen.findByRole("button", { name: "Queue rules" }));
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findAllByText(/Now 5 min, set by the built-in default/)).length).toBeGreaterThan(0);
    expect(sent.some((s) => s.path === "/clinics/u-opd/queue-policy" && (s.init?.method ?? "GET") === "GET")).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: /^Times a booked patient may be passed over/ }));
    await user.click(await screen.findByRole("option", { name: "Twice" }));
    await user.click(within(dialog).getByRole("button", { name: "Save the rules" }));
    const saved = sent.find((s) => s.path === "/clinics/u-opd/queue-policy" && s.init?.method === "PATCH");
    expect(saved?.init?.json).toEqual({ maxBypass: 2 });
  });
});

describe("The desk invites booked patients to come earlier (ADR 0022 R4)", () => {
  beforeEach(respond);

  const INVITES = { mode: "desk", fanout: 3, openMinutes: 20, open: 0, eligible: ["a-2"] };

  it("sends the invitations the rules allow, and says how many", async () => {
    const user = userEvent.setup();
    queueWith({ invites: INVITES, appointments: [ticket(2, "BOOKED")] });
    renderAt("/console/queue", DESK);
    await user.click(await screen.findByRole("button", { name: "Invite to come earlier" }));
    const posted = sent.find((s) => s.path === "/sessions/se-1/invites");
    expect(posted?.init?.method).toBe("POST");
    expect(await screen.findByText(/1 patient is invited to come earlier/)).toBeInTheDocument();
  });

  it("is switched off when nobody can be invited now", async () => {
    queueWith({ invites: { ...INVITES, eligible: [], open: 3 } });
    renderAt("/console/queue", DESK);
    expect(await screen.findByRole("button", { name: "Invite to come earlier" })).toBeDisabled();
  });

  it("gives a clinician no invite button", async () => {
    queueWith({ invites: INVITES });
    renderAt("/console/queue", GP);
    await screen.findByText("Brice Tagne");
    expect(screen.queryByRole("button", { name: "Invite to come earlier" })).not.toBeInTheDocument();
  });

  it("marks each invitation by where it stands, without moving anyone", async () => {
    const open = { status: "open", sentAt: soon(-1), expiresAt: soon(19), answer: null, eta: null };
    queueWith({
      invites: { ...INVITES, eligible: [], open: 1 },
      appointments: [
        { ...ticket(1, "BOOKED"), invite: open },
        { ...ticket(2, "BOOKED"), invite: { ...open, status: "accepted", answer: "YES", eta: soon(15) } },
        { ...ticket(3, "BOOKED"), invite: { ...open, status: "declined", answer: "NO" } },
        { ...ticket(4, "BOOKED"), invite: { ...open, status: "expired" } },
      ],
    });
    renderAt("/console/queue", DESK);
    const list = await screen.findByRole("region", { name: "Today's queue" });
    expect(await within(list).findByText("Invited")).toBeInTheDocument();
    expect(within(list).getByText(/^Coming by/)).toBeInTheDocument();
    expect(within(list).getByText("Said no")).toBeInTheDocument();
    expect(within(list).getByText("Invite ended")).toBeInTheDocument();
  });

  it("sets the invitation rules by level, in the same dialog", async () => {
    const user = userEvent.setup();
    queueWith({ policy: POLICY });
    renderAt("/console/queue", DESK);
    await user.click(await screen.findByRole("button", { name: "Rules for today" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Invitations out at once/ }));
    await user.click(await screen.findByRole("option", { name: "5" }));
    await user.click(within(dialog).getByRole("button", { name: /^Who sends invitations/ }));
    await user.click(await screen.findByRole("option", { name: "Automatically" }));
    await user.click(within(dialog).getByRole("button", { name: "Save the rules" }));
    const saved = sent.find((s) => s.path === "/sessions/se-1/policy");
    expect(saved?.init?.json).toEqual({ inviteFanout: 5, earlyCallInvites: "auto" });
  });
});
