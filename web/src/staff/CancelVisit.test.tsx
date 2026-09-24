import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "../api/client";
import type { Appointment, AppointmentType } from "../patient/data";
import { CancelVisit } from "./CancelVisit";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

const HOUR = 3600 * 1000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

function visit(hoursAhead: number): Appointment {
  return {
    appointmentId: "a-1",
    reference: "APT-1",
    clinicId: "c-akwa",
    patientProfileId: "pp-1",
    appointmentTypeId: "at-1",
    clinicianProfileId: "s-1",
    startAt: at(hoursAhead),
    endAt: at(hoursAhead + 0.5),
    state: "BOOKED",
    channel: "WEB",
    bookedByRole: null,
    createdAt: at(-72),
    version: 1,
  };
}

const TYPE = { appointmentTypeId: "at-1", name: "Follow-up", cancellationWindowMinutes: 1440 } as AppointmentType;

function open(hoursAhead = 72) {
  const onCancelled = vi.fn();
  render(
    <CancelVisit
      appointment={visit(hoursAhead)}
      patient={{ givenName: "Ama", familyName: "Darko" }}
      clinician={undefined}
      type={TYPE}
      onClose={vi.fn()}
      onCancelled={onCancelled}
    />,
  );
  return { dialog: screen.getByRole("dialog", { name: "Cancel this appointment?" }), onCancelled, user: userEvent.setup() };
}

describe("Cancelling from the desk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.mockResolvedValue({ outcome: "CLINIC_CANCELLED" });
  });

  it("will not cancel until a reason says who called it off", () => {
    const { dialog } = open();
    expect(within(dialog).getByRole("button", { name: "Cancel appointment" })).toBeDisabled();
  });

  it("fr_vis_03: a clinic reason cancels as the clinic, and says the entitlement is kept", async () => {
    const { dialog, onCancelled, user } = open();
    await user.click(within(dialog).getByRole("radio", { name: "Clinician unavailable" }));
    expect(dialog).toHaveTextContent("the patient keeps their full entitlement");
    await user.click(within(dialog).getByRole("button", { name: "Cancel appointment" }));
    expect(api).toHaveBeenCalledWith("/appointments/a-1", {
      method: "DELETE",
      json: { cancelledBy: "CLINIC", reason: "Clinician unavailable" },
    });
    expect(onCancelled).toHaveBeenCalledWith(expect.stringContaining("Ama Darko has been emailed"));
  });

  it("warns that a patient's cancellation inside the window is late", async () => {
    const { dialog, user } = open(10);
    await user.click(within(dialog).getByRole("radio", { name: "Patient called to cancel" }));
    expect(dialog).toHaveTextContent("inside the 24 hour window, so it counts as a late cancellation");
  });

  it("asks who called it off for any other reason, and keeps the note", async () => {
    const { dialog, user } = open();
    await user.click(within(dialog).getByRole("radio", { name: "Other" }));
    const submit = within(dialog).getByRole("button", { name: "Cancel appointment" });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole("radio", { name: "The patient" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Note" }), "Moved away");
    await user.click(submit);
    expect(api).toHaveBeenCalledWith("/appointments/a-1", {
      method: "DELETE",
      json: { cancelledBy: "PATIENT", reason: "Other: Moved away" },
    });
  });

  it("says what went wrong and that nothing changed", async () => {
    api.mockRejectedValue(new ApiError(409, "that appointment is already cancelled"));
    const { dialog, onCancelled, user } = open();
    await user.click(within(dialog).getByRole("radio", { name: "Double booking" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel appointment" }));
    expect(await within(dialog).findByText("That appointment is already cancelled. Nothing was changed; try again.")).toBeInTheDocument();
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
