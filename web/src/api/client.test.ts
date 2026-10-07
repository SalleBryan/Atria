import { api, apiAll } from "./client";

vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn(async () => ({ tokens: undefined })) }));

const pages: Record<string, unknown> = {
  "/api/clinics/c-1/day?from=2026-09-21&to=2026-09-27": {
    appointments: [{ appointmentId: "a-1" }, { appointmentId: "a-2" }],
    patients: { "pp-1": { givenName: "Amina" } },
    nextCursor: "Mg",
  },
  "/api/clinics/c-1/day?from=2026-09-21&to=2026-09-27&cursor=Mg": {
    appointments: [{ appointmentId: "a-3" }],
    patients: { "pp-2": { givenName: "Brice" } },
    nextCursor: null,
  },
};

describe("apiAll", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(JSON.stringify(pages[url]), { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("nfr_perf_04: follows each page's cursor and joins the lists and the names", async () => {
    const all = await apiAll<{ appointments: { appointmentId: string }[]; patients: Record<string, unknown>; nextCursor?: string | null }>(
      "/clinics/c-1/day?from=2026-09-21&to=2026-09-27",
      "appointments",
    );
    expect(all.appointments.map((a) => a.appointmentId)).toEqual(["a-1", "a-2", "a-3"]);
    expect(Object.keys(all.patients)).toEqual(["pp-1", "pp-2"]);
    expect(all.nextCursor).toBeNull();
  });
});

describe("api", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says a route the deployed server lacks is not there yet, not that the connection failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Missing Authentication Token" }), { status: 403 })),
    );
    await expect(api("/admin/staff/s-1/temporary-password", { method: "POST" })).rejects.toThrow(
      "The server does not offer this yet.",
    );
  });
});
