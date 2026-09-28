import { birthDate } from "./CompleteProfile";

describe("birthDate", () => {
  it("reads day, month and year", () => {
    expect(birthDate("02/04/1990")).toBe("1990-04-02");
    expect(birthDate("2.4.1990")).toBe("1990-04-02");
  });

  it("refuses dates that do not exist or have not happened", () => {
    expect(birthDate("31/02/1990")).toBeNull();
    expect(birthDate("01/01/1850")).toBeNull();
    expect(birthDate("01/01/2999")).toBeNull();
    expect(birthDate("1990-04-02")).toBeNull();
  });
});
