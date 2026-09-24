import { isMobile, normalisePhone } from "./phone";

describe("phone numbers on the Cameroon pack", () => {
  it.each([
    ["6 70 00 00 00", "+237670000000"],
    ["670000000", "+237670000000"],
    ["+237 670 000 000", "+237670000000"],
    ["237670000000", "+237670000000"],
    ["00237 670000000", "+237670000000"],
  ])("normalises %s to %s", (raw, e164) => {
    expect(normalisePhone(raw)).toBe(e164);
  });

  it("accepts a Cameroonian mobile", () => {
    expect(isMobile("+237670000000")).toBe(true);
  });

  it("refuses a fixed line, a short number and another country", () => {
    expect(isMobile("+237222000000")).toBe(false);
    expect(isMobile("+23767000000")).toBe(false);
    expect(isMobile("+233245550142")).toBe(false);
  });
});
