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

const ADMIN = {
  personId: "p-admin",
  givenName: "Sandrine",
  familyName: "Eyenga",
  tenantId: "t-1",
  roles: ["TENANT_ADMIN"],
  patientProfileId: null,
  staffId: "s-admin",
  clinicId: null,
} as unknown as Me;

const MANAGER = { ...ADMIN, roles: ["CLINIC_MANAGER"], clinicId: "u-med" } as unknown as Me;

const OVERVIEW = {
  tenant: {
    tenantId: "t-1",
    name: "Regional Hospital Buea",
    regionPackCode: "CM",
    gridUnitMinutes: 10,
    languages: ["en", "fr"],
    reminderLeadHours: 24,
    secondReminderHours: 0,
    queueMoveThresholdMinutes: 30,
    noShowStrikeThreshold: 0,
    noShowStrikeWindowDays: 180,
    qualityProgrammeEnabled: false,
    ratingAffectsFee: false,
    guardianConsent: "DESK_OR_GUARDIAN_ACCOUNT",
    smsSenderId: "RHBUEA",
    emailSenderName: "Regional Hospital Buea",
    firstAppointmentAt: "2026-09-19T08:12:40Z",
    regionPackLocked: true,
    lockReason: "Locked since the first appointment on 2026-09-19.",
  },
  regionPack: {
    code: "CM",
    currency: "XAF",
    dialCode: "+237",
    languages: ["fr", "en"],
    timezone: "Africa/Douala",
    allowsRatingFeeLink: false,
  },
  clinics: [
    {
      clinicId: "u-med",
      name: "Medical Unit",
      address: "Buea",
      phone: "+237600000000",
      description: "Adult internal medicine.",
      services: ["Internal medicine"],
      openingHours: { "0": { start: "07:30", end: "15:30" } },
    },
  ],
  appointmentTypes: [
    {
      appointmentTypeId: "at-spec-first",
      code: "SPEC_FIRST",
      name: "First specialist consultation",
      serviceLine: "SPECIALIST",
      durationUnits: 3,
      bufferUnits: 1,
      bookableBy: "BOTH",
      patientRequestable: false,
      minNoticeMinutes: 30,
      maxAdvanceDays: 60,
      cancellationWindowMinutes: 1440,
      feeBandId: "fb-specialist-first",
      clinicIds: null,
      active: true,
    },
  ],
  feeBands: [
    {
      feeBandId: "fb-specialist-first",
      practice: "Specialist, first visit",
      baseAmountMinor: 5000,
      scheduleReference: "",
      effectiveFrom: "2026-09-26",
    },
  ],
};

const sent: { path: string; init?: { method?: string; json?: unknown } }[] = [];

function respond() {
  sent.length = 0;
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    sent.push({ path, init });
    if (path === "/clinicians") return { clinicians: [] };
    if (path === "/clinics") return { clinics: OVERVIEW.clinics };
    if (path === "/appointment-types") return { appointmentTypes: [] };
    if (path.startsWith("/clinics/")) return { appointments: [], patients: {} };
    if (path === "/admin/settings" && !init?.method) return OVERVIEW;
    if (init?.method) return {};
    throw new Error(`unexpected ${path}`);
  });
}

function renderSettings(me: Me = ADMIN) {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={["/console/settings"]}>
        <Routes>
          {staffRoutes}
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("Hospital settings", () => {
  beforeEach(respond);

  it("shows the region pack locked and why (FR-TEN-07)", async () => {
    renderSettings();
    expect(await screen.findByText("Locked since the first appointment on 2026-09-19.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Calendar grid/ })).toBeDisabled();
  });

  it("saves only what changed (FR-ADM-03)", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("checkbox", { name: "Collect feedback" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const patch = sent.find((s) => s.init?.method === "PATCH");
    expect(patch?.path).toBe("/admin/settings");
    expect(patch?.init?.json).toEqual({ qualityProgrammeEnabled: true });
  });

  it("never offers linking ratings to fees where the pack forbids it (FR-TEN-05)", async () => {
    renderSettings();
    expect(await screen.findByRole("checkbox", { name: "Link ratings to fees" })).toBeDisabled();
  });

  it("lists visit types with their fee (FR-ADM-06)", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Visit types" }));
    const list = screen.getByRole("region", { name: "Visit types" });
    expect(within(list).getByText("First specialist consultation")).toBeInTheDocument();
    expect(within(list).getByText("5,000 XAF")).toBeInTheDocument();
  });

  it("shows every role's permissions read-only (FR-ADM-09)", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Roles" }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Read the audit log" })).toBeInTheDocument();
    expect(within(table).queryByRole("button")).not.toBeInTheDocument();
  });

  it("is an administrator's page only", async () => {
    renderSettings(MANAGER);
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(sent.some((s) => s.path === "/admin/settings")).toBe(false);
  });

  it("exposes the payment sandbox only when the API enables it", async () => {
    renderSettings();
    await screen.findByRole("checkbox", { name: "Collect feedback" });
    expect(screen.queryByRole("tab", { name: "Payment sandbox" })).not.toBeInTheDocument();
  });

  it("creates a sandbox checkout and checks the same attempt", async () => {
    const checkoutUrl = "https://checkout.fapshi.com/payment/synthetic";
    api.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/admin/settings") return { ...OVERVIEW, paymentSandboxEnabled: true };
      if (path.startsWith("/admin/payment-sandbox/")) {
        sent.push({ path, init });
        return { checkoutUrl, status: init?.method === "POST" ? "CREATED" : "SUCCESSFUL" };
      }
      return { clinicians: [], clinics: [], appointmentTypes: [] };
    });
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Payment sandbox" }));
    await user.click(screen.getByRole("button", { name: "Create test checkout" }));
    expect(await screen.findByRole("link", { name: "Open test checkout" })).toHaveAttribute("href", checkoutUrl);
    await user.click(screen.getByRole("tab", { name: "Hospital" }));
    await user.click(screen.getByRole("tab", { name: "Payment sandbox" }));
    await user.click(screen.getByRole("button", { name: "Check status" }));
    expect(await screen.findByText("Payment simulated successfully")).toBeInTheDocument();
    expect(sent).toEqual([
      { path: sent[0]?.path, init: { method: "POST" } },
      { path: sent[0]?.path, init: undefined },
    ]);
  });
});
