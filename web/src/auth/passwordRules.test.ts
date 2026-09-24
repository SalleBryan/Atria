import { allMet, passwordRules } from "./passwordRules";

const met = (password: string, temporary?: string) =>
  Object.fromEntries(passwordRules(password, temporary).map((rule) => [rule.id, rule.met]));

describe("passwordRules", () => {
  it("accepts a password the pool accepts", () => {
    expect(allMet(passwordRules("Douala-Clinic-2026"))).toBe(true);
  });

  it("names each rule a password fails", () => {
    expect(met("Short1a")).toEqual({ length: false, case: true, number: true });
    expect(met("lowercase-only-1")).toMatchObject({ case: false });
    expect(met("NoDigitsAtAllHere")).toMatchObject({ number: false });
  });

  it("asks for a number, not a symbol, as the pool does (ADR 0018)", () => {
    expect(met("Symbol-Only-No-Digits").number).toBe(false);
  });

  it("refuses the temporary password as the new one", () => {
    const temporary = "Temp-Password-2026";
    expect(met(temporary, temporary)["not-temporary"]).toBe(false);
    expect(allMet(passwordRules(temporary, temporary))).toBe(false);
    expect(met("Another-Password-2026", temporary)["not-temporary"]).toBe(true);
  });

  it("only shows the temporary rule on the first sign-in", () => {
    expect(passwordRules("x").map((rule) => rule.id)).not.toContain("not-temporary");
  });

  it("counts accented capitals as upper case", () => {
    expect(met("École-de-santé-2026").case).toBe(true);
  });
});
