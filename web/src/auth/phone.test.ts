import { countries, countryOf, isMobile, maskedPhone, nationalInput, normalisePhone, withCountry } from "./phone";

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

  it("holds a Cameroonian number to the region pack's mobile pattern", () => {
    expect(isMobile("+237222000000")).toBe(false);
    expect(isMobile("+23767000000")).toBe(false);
  });
});

describe("numbers from other countries", () => {
  it("reads a number without its code as the chosen country's", () => {
    expect(normalisePhone("024 555 0142", "GH")).toBe("+233245550142");
    expect(normalisePhone("7700 900123", "GB")).toBe("+447700900123");
  });

  it("checks another country's number by that country's rules", () => {
    expect(isMobile("+447911123456")).toBe(true);
    expect(isMobile("+4477009")).toBe(false);
  });
});

describe("countryOf", () => {
  it("knows the country from its code as it is typed", () => {
    expect(countryOf("+237 6")).toBe("CM");
    expect(countryOf("00234 803")).toBe("NG");
    expect(countryOf("+44 7700")).toBe("GB");
  });

  it("keeps the country chosen where a code is shared, and otherwise picks its main country", () => {
    expect(countryOf("+1 202", "CA")).toBe("CA");
    expect(countryOf("+1", "CM")).toBe("US");
  });

  it("says nothing of a number without a code", () => {
    expect(countryOf("670000000")).toBeUndefined();
  });
});

describe("withCountry", () => {
  it("puts the country's code in front of an empty field", () => {
    expect(withCountry("", "CM")).toBe("+237 ");
  });

  it("replaces the code already there and keeps the number", () => {
    expect(withCountry("+237 670 00 00 00", "NG")).toBe("+234 670000000");
  });
});

describe("countries", () => {
  it("lists the home country first", () => {
    expect(countries()[0]).toMatchObject({ code: "CM", dial: "+237" });
  });
});

describe("the phone field after its dial code", () => {
  it("takes a Cameroonian number without its code and groups it", () => {
    expect(nationalInput("670000000", "CM")).toEqual({ country: "CM", text: "6 70 00 00 00" });
    expect(normalisePhone(nationalInput("670000000", "CM").text, "CM")).toBe("+237670000000");
  });

  it("drops a leading 0 at home", () => {
    expect(nationalInput("0670000000", "CM").text).toBe("6 70 00 00 00");
  });

  it("takes the code off a pasted international number and switches the country", () => {
    const pasted = nationalInput("+44 7700 900123", "CM");
    expect(pasted.country).toBe("GB");
    expect(normalisePhone(pasted.text, pasted.country)).toBe("+447700900123");
    expect(nationalInput("+237 670 000 000", "CM").text).toBe("6 70 00 00 00");
  });

  it("keeps a stored number's national part when a field opens on it", () => {
    expect(nationalInput("+237691234567", "CM").text).toBe("6 91 23 45 67");
  });

  it("hides a number's middle after its own country code", () => {
    expect(maskedPhone("+12025550142")).toBe("+1 ••••••• 142");
    expect(maskedPhone("+237670000123")).toBe("+237 •••••• 123");
    expect(maskedPhone(null)).toBe("Not given");
  });
});
