import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ApiError, type Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { staffRoutes } from "./routes";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
  // The screens read whole lists through apiAll, which calls api from inside its module; route it to the stub.
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

const LISTED = [
  {
    staffId: "s-admin",
    givenName: "Sandrine",
    familyName: "Eyenga",
    signInName: "s@x.cm",
    clinicId: null,
    roles: ["TENANT_ADMIN"],
    status: "ACTIVE",
    mustSetPassword: false,
  },
  {
    staffId: "s-desk",
    givenName: "Nadine",
    familyName: "Fotso",
    signInName: "n@x.cm",
    clinicId: "c-akwa",
    roles: ["RECEPTIONIST"],
    status: "ACTIVE",
    mustSetPassword: false,
  },
  {
    staffId: "s-doc",
    givenName: "Esther",
    familyName: "Mbarga",
    signInName: "e@x.cm",
    clinicId: "c-akwa",
    roles: ["CLINICIAN"],
    status: "ACTIVE",
    mustSetPassword: false,
  },
  {
    staffId: "s-new",
    givenName: "Kofi",
    familyName: "Ngassa",
    signInName: "+12025550163",
    clinicId: "c-akwa",
    roles: ["RECEPTIONIST"],
    status: "INVITED",
    mustSetPassword: true,
  },
  {
    staffId: "s-gone",
    givenName: "Joyce",
    familyName: "Ebolo",
    signInName: "j@x.cm",
    clinicId: "c-akwa",
    roles: ["RECEPTIONIST"],
    status: "SUSPENDED",
    mustSetPassword: false,
  },
];

const change = vi.fn((_path: string, _body: unknown) => ({}));

const statusOf = (a: (typeof LISTED)[number]) => (a.status === "SUSPENDED" ? "suspended" : a.mustSetPassword ? "awaiting" : "active");

/** GET /admin/staff as the API answers it: searched, filtered, one page, with every account counted. */
function listing(path: string) {
  const ask = new URL(path, "http://x").searchParams;
  const q = (ask.get("q") ?? "").toLowerCase();
  const found = LISTED.filter(
    (a) =>
      (!q || `${a.givenName} ${a.familyName}`.toLowerCase().includes(q)) &&
      (!ask.get("status") || statusOf(a) === ask.get("status")) &&
      (!ask.get("role") || a.roles.includes(ask.get("role")!)),
  );
  const tally = (keys: string[]) => keys.reduce<Record<string, number>>((all, k) => ({ ...all, [k]: (all[k] ?? 0) + 1 }), {});
  return {
    count: found.length,
    total: LISTED.length,
    accounts: found.slice(0, Number(ask.get("limit") ?? 25)),
    nextCursor: null,
    facets: {
      roles: tally(LISTED.flatMap((a) => a.roles)),
      clinics: tally(LISTED.flatMap((a) => (a.clinicId ? [a.clinicId] : []))),
      status: tally(LISTED.map(statusOf)),
    },
  };
}

function respond(
  create: (body: unknown) => unknown = () => ({
    givenName: "Kofi",
    familyName: "Boateng",
    signInName: "+12025550177",
    temporaryPassword: "Tmp-abcd-efgh",
  }),
) {
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    if (path === "/clinicians") return { clinicians: [] };
    if (path === "/clinics") return { clinics: [{ clinicId: "c-akwa", name: "Medical Outpatient Unit" }] };
    if (path === "/appointment-types") return { appointmentTypes: [] };
    if (path.startsWith("/clinics/")) return { appointments: [], patients: {} };
    if (path === "/admin/staff" && init?.method === "POST") return create(init.json);
    if (path.startsWith("/admin/staff?")) return listing(path);
    if (path.endsWith("/roles") && init?.method === "PATCH") return change(path, init.json);
    if (path.endsWith("/suspend") && init?.method === "POST") return change(path, undefined);
    throw new Error(`unexpected ${path}`);
  });
}

function renderAccounts(me: Me = ADMIN) {
  const session = { state: { status: "signed-in", me, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={["/console/staff"]}>
        <Routes>
          {staffRoutes}
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

async function openForm() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create staff account" }));
  return { user, sheet: screen.getByRole("dialog", { name: "Create staff account" }) };
}

async function person(user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement) {
  await user.type(within(sheet).getByRole("textbox", { name: "Given name" }), "Kofi");
  await user.type(within(sheet).getByRole("textbox", { name: "Family name" }), "Boateng");
  await user.type(within(sheet).getByRole("textbox", { name: "Mobile" }), "+1 202 555 0177");
}

describe("Staff accounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fr_acc_04: only an administrator reaches it", async () => {
    respond();
    renderAccounts({ ...ADMIN, roles: ["RECEPTIONIST"], clinicId: "c-akwa" } as Me);
    expect(await screen.findByRole("heading", { name: "Day schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Staff accounts" })).not.toBeInTheDocument();
  });

  it("says what is missing before anything is sent", async () => {
    respond();
    renderAccounts();
    const { user, sheet } = await openForm();
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(sheet).toHaveTextContent("Enter their given name.");
    expect(sheet).toHaveTextContent("Choose the unit they work in.");
    expect(api).not.toHaveBeenCalledWith("/admin/staff", expect.anything());
  });

  it("fr_acc_04: creates a receptionist at a clinic, and shows the password once", async () => {
    const create = vi.fn(() => ({
      givenName: "Kofi",
      familyName: "Boateng",
      signInName: "+12025550177",
      temporaryPassword: "Tmp-abcd-efgh",
    }));
    respond(create);
    renderAccounts();
    const { user, sheet } = await openForm();
    await person(user, sheet);
    await user.click(within(sheet).getByRole("button", { name: /^Unit:/ }));
    await user.click(screen.getByRole("option", { name: "Medical Outpatient Unit" }));
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(create).toHaveBeenCalledWith({
      givenName: "Kofi",
      familyName: "Boateng",
      phoneE164: "+12025550177",
      roles: ["RECEPTIONIST"],
      clinicId: "c-akwa",
    });
    const done = await screen.findByRole("dialog", { name: "Account created for Kofi Boateng" });
    expect(done).toHaveTextContent("Tmp-abcd-efgh");
    expect(done).toHaveTextContent("only time the password is shown");
  });

  it("asks a clinician's roll details, and sends them", async () => {
    const create = vi.fn(() => ({ signInName: "+12025550177", temporaryPassword: "Tmp-1" }));
    respond(create);
    renderAccounts();
    const { user, sheet } = await openForm();
    await user.click(within(sheet).getByRole("radio", { name: "Clinician" }));
    await person(user, sheet);
    await user.click(within(sheet).getByRole("button", { name: /^Unit:/ }));
    await user.click(screen.getByRole("option", { name: "Medical Outpatient Unit" }));
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(sheet).toHaveTextContent("Enter their specialty.");
    expect(sheet).toHaveTextContent("Choose at least one language they consult in.");
    await user.type(within(sheet).getByRole("textbox", { name: "Specialty" }), "Paediatrics");
    await user.type(within(sheet).getByRole("textbox", { name: "Year on the Order's roll" }), "2012");
    await user.type(within(sheet).getByRole("textbox", { name: "Ordre number" }), "CM-ONMC-00123");
    await user.click(within(sheet).getByRole("button", { name: "French" }));
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: ["CLINICIAN"],
        specialty: "Paediatrics",
        registrationYear: 2012,
        ordreNumber: "CM-ONMC-00123",
        languages: ["fr"],
      }),
    );
  });

  it("an administrator needs an email and no clinic", async () => {
    const create = vi.fn(() => ({ signInName: "a@b.cm", temporaryPassword: "Tmp-1" }));
    respond(create);
    renderAccounts();
    const { user, sheet } = await openForm();
    await user.click(within(sheet).getByRole("radio", { name: "Tenant administrator" }));
    expect(within(sheet).queryByRole("button", { name: /^Unit:/ })).not.toBeInTheDocument();
    await person(user, sheet);
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(sheet).toHaveTextContent("An administrator signs in with an email address.");
    await user.type(within(sheet).getByRole("textbox", { name: "Work email" }), "a@b.cm");
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ roles: ["TENANT_ADMIN"], email: "a@b.cm" }));
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ clinicId: expect.anything() }));
  });

  it("states what the role may do, from the permission matrix", async () => {
    respond();
    renderAccounts();
    const { user, sheet } = await openForm();
    const allowed = () => within(sheet).getByRole("list", { name: "What this role can do" });
    expect(allowed()).toHaveTextContent("Read intake answers or care context: no");
    await user.click(within(sheet).getByRole("radio", { name: "Clinician" }));
    expect(allowed()).toHaveTextContent("Read intake answers or care context: yes");
    expect(allowed()).toHaveTextContent("View their own calendar: yes");
  });

  it("says why nothing was created", async () => {
    respond(() => {
      throw new ApiError(409, "that phone number or email is already in use");
    });
    renderAccounts();
    const { user, sheet } = await openForm();
    await person(user, sheet);
    await user.click(within(sheet).getByRole("button", { name: /^Unit:/ }));
    await user.click(screen.getByRole("option", { name: "Medical Outpatient Unit" }));
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(
      await within(sheet).findByText("That phone number or email is already in use. Nothing was created; check the details and try again."),
    ).toBeInTheDocument();
  });

  it("fr_acc_04: lists every account with its group and status", async () => {
    respond();
    renderAccounts();
    const list = await screen.findByRole("region", { name: "Staff accounts" });
    expect(await within(list).findByText("Nadine Fotso")).toBeInTheDocument();
    expect(screen.getByText("5 users")).toBeInTheDocument();
    expect(within(list).getByText("ADMIN")).toBeInTheDocument();
    expect(within(list).getByText("Awaiting first sign-in")).toBeInTheDocument();
    expect(within(list).getByText("Suspended")).toBeInTheDocument();
    expect(list).toHaveTextContent("1 account has a temporary password");
  });

  it("nfr_perf_04: asks for one page at a time, and searches on the server", async () => {
    respond();
    renderAccounts();
    await screen.findByText("Nadine Fotso");
    expect(api).toHaveBeenCalledWith("/admin/staff?limit=50");
    await userEvent.setup().type(screen.getByRole("combobox", { name: "Search accounts" }), "kofi");
    expect(await screen.findByText("1 of 5 users")).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("/admin/staff?limit=50&q=kofi");
  });

  it("filters to those awaiting their first sign-in", async () => {
    respond();
    renderAccounts();
    await screen.findByText("Nadine Fotso");
    await userEvent.setup().click(screen.getByRole("radio", { name: "Awaiting first sign-in" }));
    expect(await screen.findByText("1 of 5 users")).toBeInTheDocument();
    expect(screen.getByText("Kofi Ngassa")).toBeInTheDocument();
    expect(screen.queryByText("Nadine Fotso")).not.toBeInTheDocument();
  });

  it("fr_acc_18: moves the front desk to unit manager, from the next sign-in", async () => {
    respond();
    renderAccounts();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actions for Nadine Fotso" }));
    await user.click(screen.getByRole("menuitem", { name: "Change role" }));
    const dialog = screen.getByRole("dialog", { name: "Change Nadine Fotso's role" });
    await user.click(within(dialog).getByRole("radio", { name: /Unit manager/ }));
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));
    expect(change).toHaveBeenCalledWith("/admin/staff/s-desk/roles", { roles: ["CLINIC_MANAGER"] });
    expect(await screen.findByText(/becomes unit manager at their next sign-in/)).toBeInTheDocument();
  });

  it("sends a clinician's change of role to a new account instead", async () => {
    respond();
    renderAccounts();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actions for Esther Mbarga" }));
    await user.click(screen.getByRole("menuitem", { name: "Change role" }));
    const dialog = screen.getByRole("dialog", { name: "Change Esther Mbarga's role" });
    expect(dialog).toHaveTextContent("Create one for the new role, then suspend this one.");
    expect(within(dialog).queryByRole("button", { name: "Change role" })).not.toBeInTheDocument();
  });

  it("suspends an account", async () => {
    respond();
    renderAccounts();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actions for Kofi Ngassa" }));
    await user.click(screen.getByRole("menuitem", { name: "Suspend" }));
    await user.click(within(screen.getByRole("dialog", { name: "Suspend Kofi Ngassa?" })).getByRole("button", { name: "Suspend" }));
    expect(change).toHaveBeenCalledWith("/admin/staff/s-new/suspend", undefined);
  });

  it("offers nothing on an account already suspended, or on the administrator's own", async () => {
    respond();
    renderAccounts();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actions for Joyce Ebolo" }));
    expect(screen.getByRole("menuitem", { name: /^Suspend/ })).toBeDisabled();
    expect(screen.getByText("Already suspended")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Actions for Sandrine Eyenga" }));
    expect(screen.getByRole("menuitem", { name: /^Suspend/ })).toBeDisabled();
  });
});
