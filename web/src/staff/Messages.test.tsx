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
  givenName: "Mireille",
  familyName: "Ekane",
  tenantId: "t-1",
  roles: ["RECEPTIONIST"],
  patientProfileId: null,
  staffId: "s-desk",
  clinicId: "u-med",
} as unknown as Me;
const ADMIN = { ...DESK, roles: ["TENANT_ADMIN"], clinicId: null } as unknown as Me;
const DOCTOR = { ...DESK, roles: ["CLINICIAN"] } as unknown as Me;

const message = (over: Record<string, unknown>) => ({
  messageLogId: "ml-1",
  appointmentId: "a-1",
  kind: "APPOINTMENT_REMINDER",
  channel: "SMS",
  recipient: "+237600000101",
  deliveryState: "DELIVERED",
  feedback: null,
  failureReason: null,
  settledAt: "2026-09-27T08:00:00Z",
  person: { name: "Amina Ngo", phoneE164: "+237600000101" },
  visit: { startAt: "2026-09-28T08:00:00Z", state: "BOOKED", patientProfileId: "pp-1" },
  ...over,
});

const LOG = {
  clinicId: "u-med",
  clinicName: "Medical Unit",
  day: "2026-09-27",
  counts: { FAILED: 1, DELIVERED: 1 },
  messages: [
    message({
      messageLogId: "ml-2",
      appointmentId: "a-2",
      deliveryState: "FAILED",
      failureReason: "Phone is unreachable",
      person: { name: "Brice Tagne", phoneE164: "+237600000102" },
    }),
    message({}),
  ],
};

const FIGURES = {
  email: { attempted: 4, delivered: 3, failed: 1, bounced: 1, complained: 0, deliveryRate: 0.75, bounceRate: 0.25, complaintRate: 0 },
  sms: { attempted: 10, delivered: 9, failed: 1, deliveryRate: 0.9, spendUsd: "0.3220" },
};
const DELIVERY = {
  from: "2026-09-14",
  to: "2026-09-27",
  senders: [{ identity: "notices@atria.invalid", type: "EMAIL_ADDRESS", verified: true, sendingEnabled: true, sandbox: true }],
  sms: { sandbox: true },
  totals: FIGURES,
  days: [{ day: "2026-09-27", ...FIGURES }],
};

const asked: string[] = [];

function respond() {
  asked.length = 0;
  api.mockImplementation(async (path: string) => {
    asked.push(path);
    if (path === "/clinicians") return { clinicians: [] };
    if (path === "/clinics") return { clinics: [{ clinicId: "u-med", name: "Medical Unit" }] };
    if (path === "/appointment-types") return { appointmentTypes: [] };
    if (path.startsWith("/clinics/u-med/day")) return { appointments: [], patients: {} };
    if (path.startsWith("/clinics/u-med/messages")) return LOG;
    if (path.startsWith("/messages/delivery")) return DELIVERY;
    throw new Error(`unexpected ${path}`);
  });
}

function renderAt(me: Me) {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={["/console/messages"]}>
        <Routes>
          {staffRoutes}
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("Messages", () => {
  beforeEach(respond);

  it("lists failures first with the number to phone (FR-MSG-05)", async () => {
    renderAt(DESK);
    const card = await screen.findByRole("region", { name: "Messages sent" });
    const rows = await within(card).findAllByRole("listitem");
    expect(within(rows[0]!).getByText("Brice Tagne")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Failed")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Phone is unreachable")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("link", { name: "+237600000102" })).toHaveAttribute("href", "tel:+237600000102");
    expect(screen.getByText(/1 message did not reach the patient/)).toBeInTheDocument();
    expect(asked.some((p) => p.startsWith("/clinics/u-med/messages?day="))).toBe(true);
  });

  it("is in the desk's navigation", async () => {
    renderAt(DESK);
    expect((await screen.findAllByRole("link", { name: "Messages" })).length).toBeGreaterThan(0);
  });

  it("is not a clinician's", async () => {
    renderAt(DOCTOR);
    await screen.findAllByRole("link", { name: "Schedule" });
    expect(screen.queryByRole("link", { name: "Messages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Messages sent" })).not.toBeInTheDocument();
  });

  it("gives an administrator the delivery figures (FR-MSG-06)", async () => {
    renderAt(ADMIN);
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Delivery" }));
    const tiles = await screen.findByRole("region", { name: "Delivery in numbers" });
    expect(within(tiles).getByText("75%")).toBeInTheDocument();
    expect(within(tiles).getByText("25%")).toBeInTheDocument();
    expect(within(tiles).getByText("$0.32")).toBeInTheDocument();
    expect(screen.getByText("notices@atria.invalid")).toBeInTheDocument();
    expect(screen.getByText("Sandbox: verified numbers only")).toBeInTheDocument();
  });

  it("gives the desk no delivery tab", async () => {
    renderAt(DESK);
    await screen.findByRole("region", { name: "Messages sent" });
    expect(screen.queryByRole("tab", { name: "Delivery" })).not.toBeInTheDocument();
  });
});
