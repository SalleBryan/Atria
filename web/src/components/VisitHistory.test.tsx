import { render, screen } from "@testing-library/react";

import { VisitHistory, type VisitEvent } from "./VisitHistory";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

function event(kind: string, at: string, extra: Partial<VisitEvent> = {}): VisitEvent {
  return {
    appointmentEventId: `ae-${kind}`,
    kind,
    toState: kind,
    actorRole: null,
    byYou: false,
    occurredAt: at,
    previousStartAt: null,
    rescheduledBy: null,
    reason: null,
    ...extra,
  };
}

function show(audience: "patient" | "staff") {
  return render(
    <VisitHistory appointmentId="a-1" audience={audience} fallback={<li>Worked out from the state</li>}>
      <li>SMS reminder</li>
    </VisitHistory>,
  );
}

describe("VisitHistory", () => {
  it("tells the patient what happened, a move included, then what is to come", async () => {
    api.mockResolvedValue({
      history: [
        event("BOOKED", "2026-10-01T08:00:00Z", { byYou: true }),
        event("RESCHEDULED", "2026-10-02T09:00:00Z", { actorRole: "RECEPTIONIST", previousStartAt: "2026-10-08T09:00:00Z" }),
      ],
    });
    show("patient");
    expect(await screen.findByText("Booked by you")).toBeInTheDocument();
    expect(screen.getByText(/^Moved from .+ by a receptionist$/)).toBeInTheDocument();
    expect(screen.getByText("SMS reminder")).toBeInTheDocument();
    expect(screen.queryByText("Worked out from the state")).not.toBeInTheDocument();
  });

  it("says a hospital cancellation was the hospital's, whoever pressed it", async () => {
    api.mockResolvedValue({
      history: [event("CANCELLED", "2026-10-02T09:00:00Z", { toState: "CLINIC_CANCELLED", actorRole: "RECEPTIONIST" })],
    });
    show("patient");
    expect(await screen.findByText("Cancelled by the hospital")).toBeInTheDocument();
  });

  it("shows staff the reason given", async () => {
    api.mockResolvedValue({
      history: [event("RESCHEDULED", "2026-10-02T09:00:00Z", { actorRole: "CLINIC_MANAGER", reason: "Clinician called away" })],
    });
    show("staff");
    expect(await screen.findByText(/Clinician called away/)).toBeInTheDocument();
  });

  it("keeps the worked-out steps for a visit recorded before events were kept", async () => {
    api.mockResolvedValue({ history: [] });
    show("patient");
    expect(await screen.findByText("Worked out from the state")).toBeInTheDocument();
  });

  it("says what happened to a reminder once it is on record, and why one failed to staff", async () => {
    api.mockResolvedValue({
      history: [event("BOOKED", "2026-10-01T08:00:00Z")],
      reminders: [
        {
          channel: "SMS",
          deliveryState: "DELIVERED",
          sentAt: "2026-10-04T07:20:00Z",
          settledAt: "2026-10-04T07:21:00Z",
          feedback: null,
          failureReason: null,
        },
        {
          channel: "EMAIL",
          deliveryState: "FAILED",
          sentAt: "2026-10-04T07:20:00Z",
          settledAt: "2026-10-04T07:20:00Z",
          feedback: null,
          failureReason: "AccessDeniedException",
        },
      ],
    });
    show("staff");
    expect(await screen.findByText("SMS reminder delivered")).toBeInTheDocument();
    expect(screen.getByText("Email reminder failed")).toBeInTheDocument();
    expect(screen.getByText(/Tell your administrator/)).toBeInTheDocument();
    expect(screen.queryByText("SMS reminder")).not.toBeInTheDocument();
  });

  it("tells a patient a reminder failed, never the provider's reason", async () => {
    api.mockResolvedValue({
      history: [event("BOOKED", "2026-10-01T08:00:00Z")],
      reminders: [{ channel: "SMS", deliveryState: "FAILED", sentAt: "2026-10-04T07:20:00Z", settledAt: null, feedback: null }],
    });
    show("patient");
    expect(await screen.findByText("SMS reminder failed")).toBeInTheDocument();
    expect(screen.queryByText(/network/)).not.toBeInTheDocument();
  });
});
