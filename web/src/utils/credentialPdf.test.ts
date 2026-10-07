/**
 * The credentials PDF (2026-10-01, restyled 2026-10-07): made with the real
 * jsPDF, its text read back, so a credential can never go missing from it.
 */

// The real jsPDF, with what it writes and the name it saves under caught.
const caught = vi.hoisted(() => ({ written: [] as string[], saved: [] as string[] }));
vi.mock("jspdf", async (original) => {
  const real = await original<typeof import("jspdf")>();
  class Capturing extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args);
      const text = this.text.bind(this);
      this.text = ((value: string | string[], ...rest: unknown[]) => {
        caught.written.push(...(Array.isArray(value) ? value : [value]));
        return (text as (...a: unknown[]) => unknown)(value, ...rest);
      }) as typeof this.text;
      this.save = ((name: string) => {
        caught.saved.push(name);
        return this;
      }) as unknown as typeof this.save;
    }
  }
  return { ...real, jsPDF: Capturing };
});

import { downloadBatchStaffPdf, downloadSingleStaffPdf, type StaffCredential } from "./credentialPdf";

const SAMUEL: StaffCredential = {
  name: "Samuel Eto'o",
  role: "Clinician",
  unit: "General Outpatient Department",
  signInName: "samuel.etoo@example.cm",
  temporaryPassword: "TempPass123!",
};

const MARIE: StaffCredential = {
  name: "Marie Fotso",
  role: "Receptionist",
  unit: "General Outpatient Department",
  signInName: "+237670112233",
  temporaryPassword: "AnotherPass456!",
};

describe("credentialPdf", () => {
  // The fonts are not served in a test; the PDF falls back to its own faces.
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    caught.written.length = 0;
    caught.saved.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names one account's sheet after them and carries both credentials", async () => {
    await downloadSingleStaffPdf(SAMUEL);
    expect(caught.saved).toEqual(["Atria Staff credentials Samuel Eto'o.pdf"]);
    expect(caught.written).toEqual(expect.arrayContaining(["samuel.etoo@example.cm", "TempPass123!"]));
    expect(caught.written.join(" ")).toContain("7 days");
  });

  it("puts every account of a batch in one PDF", async () => {
    await downloadBatchStaffPdf([SAMUEL, MARIE]);
    expect(caught.saved[0]).toMatch(/^Atria Staff credentials 2 accounts \d{4}-\d{2}-\d{2}\.pdf$/);
    expect(caught.written).toEqual(expect.arrayContaining(["TempPass123!", "AnotherPass456!", "+237670112233"]));
    expect(caught.written.some((t) => /^Page 1 of \d+$/.test(t))).toBe(true);
  });
});
