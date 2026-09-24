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

function respond(create: (body: unknown) => unknown = () => ({ givenName: "Kofi", familyName: "Boateng", signInName: "+12025550177", temporaryPassword: "Tmp-abcd-efgh" })) {
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    if (path === "/clinicians") return { clinicians: [] };
    if (path === "/clinics") return { clinics: [{ clinicId: "c-akwa", name: "Clinique d'Akwa" }] };
    if (path === "/appointment-types") return { appointmentTypes: [] };
    if (path.startsWith("/clinics/")) return { appointments: [], patients: {} };
    if (path === "/admin/staff" && init?.method === "POST") return create(init.json);
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
    expect(sheet).toHaveTextContent("Choose the clinic they work at.");
    expect(api).not.toHaveBeenCalledWith("/admin/staff", expect.anything());
  });

  it("fr_acc_04: creates a receptionist at a clinic, and shows the password once", async () => {
    const create = vi.fn(() => ({ givenName: "Kofi", familyName: "Boateng", signInName: "+12025550177", temporaryPassword: "Tmp-abcd-efgh" }));
    respond(create);
    renderAccounts();
    const { user, sheet } = await openForm();
    await person(user, sheet);
    await user.selectOptions(within(sheet).getByRole("combobox"), "c-akwa");
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
    await user.selectOptions(within(sheet).getByRole("combobox"), "c-akwa");
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(sheet).toHaveTextContent("Enter their specialty.");
    expect(sheet).toHaveTextContent("Choose at least one language they consult in.");
    await user.type(within(sheet).getByRole("textbox", { name: "Specialty" }), "Paediatrics");
    await user.type(within(sheet).getByRole("textbox", { name: "Year on the Order's roll" }), "2012");
    await user.type(within(sheet).getByRole("textbox", { name: "Ordre number" }), "CM-ONMC-00123");
    await user.click(within(sheet).getByRole("button", { name: "French" }));
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ["CLINICIAN"], specialty: "Paediatrics", registrationYear: 2012, ordreNumber: "CM-ONMC-00123", languages: ["fr"] }),
    );
  });

  it("an administrator needs an email and no clinic", async () => {
    const create = vi.fn(() => ({ signInName: "a@b.cm", temporaryPassword: "Tmp-1" }));
    respond(create);
    renderAccounts();
    const { user, sheet } = await openForm();
    await user.click(within(sheet).getByRole("radio", { name: "Tenant administrator" }));
    expect(within(sheet).queryByRole("combobox")).not.toBeInTheDocument();
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
    await user.selectOptions(within(sheet).getByRole("combobox"), "c-akwa");
    await user.click(within(sheet).getByRole("button", { name: "Create account" }));
    expect(
      await within(sheet).findByText("That phone number or email is already in use. Nothing was created; check the details and try again."),
    ).toBeInTheDocument();
  });
});
