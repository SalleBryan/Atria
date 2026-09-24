import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PatientDataProvider } from "./data";
import { Visits } from "./Visits";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

const HOUR = 3600 * 1000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");

function visit(id: string, hoursAhead: number, state = "BOOKED") {
  return {
    appointmentId: id,
    reference: `APT-${id}`,
    clinicId: "c-akwa",
    appointmentTypeId: "at-spec",
    clinicianProfileId: "s-mbarga",
    startAt: at(hoursAhead),
    endAt: at(hoursAhead + 0.5),
    state,
    channel: "ONLINE",
    createdAt: at(-48),
  };
}

function respond(
  appointments: unknown[],
  cancel = vi.fn((_path: string, _body: unknown) => ({ outcome: "CANCELLED_IN_WINDOW" })),
) {
  api.mockImplementation(async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    if (path.startsWith("/patients/me/appointments")) return { appointments };
    if (path === "/clinicians") {
      return {
        clinicians: [
          { clinicianProfileId: "s-mbarga", clinicId: "c-akwa", givenName: "Esther", familyName: "Mbarga", specialty: "Paediatrics", languages: [], qualifications: [], registrationYear: 2008, seniorityBand: "EXPERIENCED" },
        ],
      };
    }
    if (path === "/clinics") return { clinics: [{ clinicId: "c-akwa", name: "Clinique d'Akwa", address: "Douala", phone: null, openingHours: null }] };
    if (path === "/appointment-types") {
      return {
        gridUnitMinutes: 10,
        appointmentTypes: [
          { appointmentTypeId: "at-spec", name: "First specialist consultation", serviceLine: "SPECIALIST", durationUnits: 3, bookableBy: "BOTH", cancellationWindowMinutes: 1440 },
        ],
      };
    }
    if (init.method === "DELETE") return cancel(path, init.json);
    throw new Error(`unexpected ${path}`);
  });
  return cancel;
}

function renderVisits(path = "/visits") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PatientDataProvider>
        <Routes>
          <Route path="/visits" element={<Visits />} />
          <Route path="/visits/:id" element={<Visits />} />
        </Routes>
      </PatientDataProvider>
    </MemoryRouter>,
  );
}

describe("Visits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists what is ahead and details the first", async () => {
    respond([visit("later", 200), visit("soon", 60)]);
    renderVisits();
    const list = await screen.findByRole("list", { name: "Upcoming visits" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Visit details" })).toHaveTextContent("APT-soon");
  });

  it("keeps cancelled and past visits under past", async () => {
    respond([visit("soon", 60), visit("gone", 80, "PATIENT_CANCELLED"), visit("before", -300, "COMPLETED")]);
    renderVisits("/visits?show=past");
    const list = await screen.findByRole("list", { name: "Past visits" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(list).toHaveTextContent("Cancelled");
  });

  it("cancels with the reason chosen, and says so", async () => {
    const cancel = respond([visit("soon", 60)]);
    renderVisits("/visits/soon?cancel=1");
    const dialog = await screen.findByRole("dialog", { name: "Cancel this visit?" });
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("radio", { name: "Schedule clash" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel visit" }));
    expect(cancel).toHaveBeenCalledWith("/appointments/soon", { reason: "Schedule clash" });
    expect(await screen.findByText(/Visit APT-soon cancelled/)).toBeInTheDocument();
  });

  it("warns before confirming that a cancellation inside the window is late", async () => {
    respond([visit("tomorrow", 10)]);
    renderVisits("/visits/tomorrow?cancel=1");
    const dialog = await screen.findByRole("dialog", { name: "Cancel this visit?" });
    expect(dialog).toHaveTextContent("inside the 24 hour cancellation window, so the clinic will record a late cancellation");
  });

  it("offers no cancel for a visit that is over", async () => {
    respond([visit("before", -300, "COMPLETED")]);
    renderVisits("/visits/before");
    await screen.findByRole("region", { name: "Visit details" });
    expect(screen.queryByRole("button", { name: "Cancel visit" })).not.toBeInTheDocument();
  });
});
