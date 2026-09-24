import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { PatientDataProvider } from "./data";
import { FindCare } from "./FindCare";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

const DAY = 24 * 3600 * 1000;
/** A start well inside the week shown, on the clinic's clock. */
const START = new Date(Math.ceil((Date.now() + 2 * DAY) / 600000) * 600000).toISOString().replace(/\.\d{3}Z$/, "Z");
const END = new Date(Date.parse(START) + 30 * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");

const CLINICIANS = [
  { clinicianProfileId: "s-mbarga", clinicId: "c-akwa", givenName: "Esther", familyName: "Mbarga", specialty: "Paediatrics", languages: ["fr", "en"], qualifications: [], registrationYear: 2008, seniorityBand: "EXPERIENCED" },
  { clinicianProfileId: "s-nkoulou", clinicId: "c-akwa", givenName: "Jean-Paul", familyName: "Nkoulou", specialty: "Cardiology", languages: ["fr"], qualifications: [], registrationYear: 1999, seniorityBand: "SENIOR" },
];

function respond(book: (body: unknown, init: RequestInit) => unknown) {
  api.mockImplementation(async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    if (path.startsWith("/patients/me/appointments")) return { appointments: [] };
    if (path === "/clinicians") return { clinicians: CLINICIANS };
    if (path === "/clinics") return { clinics: [{ clinicId: "c-akwa", name: "Clinique d'Akwa", address: "Douala", phone: null, openingHours: null }] };
    if (path === "/appointment-types") {
      return {
        gridUnitMinutes: 10,
        appointmentTypes: [
          { appointmentTypeId: "at-spec", name: "First specialist consultation", serviceLine: "SPECIALIST", durationUnits: 3, bookableBy: "BOTH", maxAdvanceDays: 60 },
          { appointmentTypeId: "at-general", name: "General consultation", serviceLine: "GENERAL", durationUnits: null, bookableBy: "BOTH" },
        ],
      };
    }
    if (path.includes("/slots")) {
      const date = new URLSearchParams(path.split("?")[1]).get("date");
      return { slots: date === START.slice(0, 10) ? [{ startAt: START, endAt: END }] : [] };
    }
    if (path === "/appointments" && init.method === "POST") return book(init.json, init);
    throw new Error(`unexpected ${path}`);
  });
}

function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{location.pathname}</p>;
}

function renderFindCare() {
  return render(
    <MemoryRouter initialEntries={["/find-care"]}>
      <PatientDataProvider>
        <Routes>
          <Route path="/find-care" element={<FindCare />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </PatientDataProvider>
    </MemoryRouter>,
  );
}

async function chooseTheTime() {
  const user = userEvent.setup();
  const time = await screen.findByRole("radio", { name: /^\d\d:\d\d$/ }, { timeout: 4000 });
  await user.click(time);
  return user;
}

describe("FindCare", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the directory and offers only specialist visits a patient can book", async () => {
    respond(() => ({}));
    renderFindCare();
    const list = await screen.findByRole("list", { name: "Clinicians" });
    expect(within(list).getByText("Dr Esther Mbarga")).toBeInTheDocument();
    expect(within(list).getByText("Dr Jean-Paul Nkoulou")).toBeInTheDocument();
    // One specialist type only, so no switch; the general queue is Phase 2.
    expect(screen.queryByRole("radiogroup", { name: "Kind of visit" })).not.toBeInTheDocument();
  });

  it("narrows by specialty", async () => {
    respond(() => ({}));
    renderFindCare();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cardiology" }));
    const list = screen.getByRole("list", { name: "Clinicians" });
    expect(within(list).queryByText("Dr Esther Mbarga")).not.toBeInTheDocument();
    expect(within(list).getByText("Dr Jean-Paul Nkoulou")).toBeInTheDocument();
  });

  it("books the chosen time with an idempotency key, then shows the booking", async () => {
    const book = vi.fn(() => ({ appointmentId: "a-new", startAt: START, endAt: END, state: "BOOKED" }));
    respond(book);
    renderFindCare();
    const user = await chooseTheTime();
    await user.click(screen.getByRole("button", { name: "Book appointment" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/booked/a-new");
    expect(book).toHaveBeenCalledWith(
      { appointmentTypeId: "at-spec", clinicianProfileId: "s-mbarga", startAt: START },
      expect.objectContaining({ headers: { "Idempotency-Key": expect.any(String) } }),
    );
  });

  it("offers the closest openings when somebody else took the time", async () => {
    const { ApiError } = await import("../api/client");
    respond(() => {
      throw new ApiError(409, "that time has just been taken");
    });
    renderFindCare();
    const user = await chooseTheTime();
    await user.click(screen.getByRole("button", { name: "Book appointment" }));
    expect(await screen.findByRole("heading", { name: "Someone took that slot." })).toBeInTheDocument();
    expect(screen.getByLabelText("The time that was taken")).toHaveTextContent("TAKEN");
    // The one free time was the taken one, so nothing else is offered.
    await waitFor(() => expect(screen.getByText("No other openings in this range")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Hold this slot" })).toBeDisabled();
  });

  it("keeps booking unavailable until a time is chosen", async () => {
    respond(() => ({}));
    renderFindCare();
    expect(await screen.findByRole("button", { name: "Book appointment" })).toBeDisabled();
    expect(screen.getByText("Pick a time above to continue")).toBeInTheDocument();
  });
});
