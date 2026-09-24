import { calendarEntry } from "./calendar";
import { type Appointment, clock, stateLabel, until, upcoming } from "./data";

const visit = (overrides: Partial<Appointment> = {}): Appointment => ({
  appointmentId: "a-1",
  reference: "APT-4958",
  clinicId: "c-douala-akwa",
  patientProfileId: "pp-1",
  appointmentTypeId: "at-spec-first",
  clinicianProfileId: "s-mbarga",
  startAt: "2026-09-26T09:00:00Z",
  endAt: "2026-09-26T09:30:00Z",
  state: "BOOKED",
  channel: "WEB",
  bookedByRole: "PATIENT",
  createdAt: "2026-09-24T13:24:00Z",
  version: 1,
  ...overrides,
});

describe("the clinic's clock", () => {
  it("shows times in Douala, not the browser's zone", () => {
    // 09:00 UTC is 10:00 in Douala, all year.
    expect(clock.time("2026-09-26T09:00:00Z")).toBe("10:00");
    expect(clock.time("2026-01-15T09:00:00Z")).toBe("10:00");
  });

  it("writes days as the frames do, with three-letter months", () => {
    expect(clock.day("2026-09-26T09:00:00Z")).toBe("Sat 26 Sep");
    expect(clock.month("2026-09-26T09:00:00Z")).toBe("SEP");
  });

  it("puts 23:30 UTC on the next local date", () => {
    expect(clock.isoDate("2026-09-26T23:30:00Z")).toBe("2026-09-27");
  });

  it("counts down in days, then hours, then minutes", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(until("2026-09-26T09:00:00Z", now)).toBe("2 days");
    expect(until("2026-09-25T09:00:00Z", now)).toBe("Tomorrow");
    expect(until("2026-09-24T15:00:00Z", now)).toBe("3 h");
    expect(until("2026-09-24T12:20:00Z", now)).toBe("20 min");
  });
});

describe("visits", () => {
  it("lists only what is booked and ahead, soonest first", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const list = [
      visit({ appointmentId: "later", startAt: "2026-10-02T13:20:00Z" }),
      visit({ appointmentId: "soon" }),
      visit({ appointmentId: "cancelled", state: "PATIENT_CANCELLED" }),
      visit({ appointmentId: "past", startAt: "2026-09-01T08:00:00Z" }),
    ];
    expect(upcoming(list, now).map((a) => a.appointmentId)).toEqual(["soon", "later"]);
  });

  it("names every state in the patient's words", () => {
    expect(stateLabel("BOOKED").label).toBe("Confirmed");
    expect(stateLabel("PATIENT_CANCELLED").tone).toBe("cancelled");
    expect(stateLabel("SOMETHING_NEW").label).toBe("SOMETHING_NEW");
  });
});

describe("add to calendar", () => {
  const entry = calendarEntry(
    visit(),
    {
      clinician: {
        clinicianProfileId: "s-mbarga",
        clinicId: "c-douala-akwa",
        givenName: "Esther",
        familyName: "Mbarga",
        specialty: "Paediatrics",
        qualifications: [],
        registrationYear: 2008,
        seniorityBand: "EXPERIENCED",
        languages: ["fr"],
      },
      clinic: {
        clinicId: "c-douala-akwa",
        name: "Clinique d'Akwa",
        address: "Rue Joss, Akwa, Douala",
        phone: null,
        openingHours: null,
      },
    },
    new Date("2026-09-24T12:00:00Z"),
  );

  it("is a calendar event in UTC, so every device places it at the clinic's time", () => {
    expect(entry).toContain("DTSTART:20260926T090000Z");
    expect(entry).toContain("DTEND:20260926T093000Z");
    expect(entry).toContain("UID:a-1@atria");
  });

  it("escapes commas in the location, as the format requires", () => {
    expect(entry).toContain("LOCATION:Clinique d'Akwa\\, Rue Joss\\, Akwa\\, Douala");
  });

  it("uses CRLF line endings and a two hour alarm", () => {
    expect(entry.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
    expect(entry).toContain("TRIGGER:-PT2H");
  });
});
