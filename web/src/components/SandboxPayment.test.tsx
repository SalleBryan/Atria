import { act, fireEvent, render, screen } from "@testing-library/react";

import { FeePayment, PayFee } from "./SandboxPayment";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api }));

const NONE = { appointmentId: "a-1", status: "NONE", paid: false, amount: 1500, currency: "XAF" };
const STARTED = { ...NONE, status: "PENDING", payerPhone: "6.. ... 000" };
const PAID = { ...STARTED, status: "SUCCESSFUL", paid: true };

describe("PayFee, the patient's side", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends only the phone and attempt ID, then polls for verified payment", async () => {
    api.mockResolvedValueOnce(NONE).mockResolvedValueOnce(STARTED).mockResolvedValueOnce(PAID);
    render(<PayFee appointmentId="a-1" />);
    const pay = await screen.findByRole("button", { name: "Pay 1,500 XAF with mobile money" });
    expect(pay).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Mobile money number" }), { target: { value: "+237 670000000" } });
    vi.useFakeTimers();
    try {
      await act(async () => fireEvent.click(pay));
      expect(screen.getByRole("status")).toHaveTextContent("Approve the payment on your phone. We sent a prompt to 6.. ... 000.");
      expect(api.mock.calls[1]).toEqual([
        "/appointments/a-1/payment",
        {
          method: "POST",
          json: { attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/), phone: "+237 670000000" },
        },
      ]);
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(screen.getByRole("status")).toHaveTextContent("Fee paid, 1,500 XAF");
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(api).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the payer start a new attempt after failure", async () => {
    api.mockResolvedValueOnce({ ...STARTED, status: "FAILED" });
    render(<PayFee appointmentId="a-1" />);
    expect(await screen.findByRole("status")).toHaveTextContent("You can try again");
    expect(screen.getByRole("textbox", { name: "Mobile money number" })).toBeEnabled();
  });

  it("stays out of the way where the sandbox is not there", async () => {
    api.mockRejectedValueOnce(new Error("forbidden"));
    const { container } = render(<PayFee appointmentId="a-1" />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("offers nothing for a visit with no fee", async () => {
    api.mockResolvedValueOnce({ ...NONE, amount: null, currency: null });
    const { container } = render(<PayFee appointmentId="a-1" />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FeePayment, the desk's side", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms the full amount was paid", async () => {
    api.mockResolvedValueOnce(PAID);
    render(
      <dl>
        <FeePayment appointmentId="a-1" />
      </dl>,
    );
    expect(await screen.findByText("Paid in full, 1,500 XAF by mobile money (6.. ... 000)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("shows what is owed and checks again on request", async () => {
    api.mockResolvedValueOnce(STARTED).mockResolvedValueOnce(PAID);
    render(
      <dl>
        <FeePayment appointmentId="a-1" />
      </dl>,
    );
    expect(await screen.findByText("Waiting for the payer to approve")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Paid in full, 1,500 XAF by mobile money (6.. ... 000)")).toBeInTheDocument();
  });

  it("says nothing has been paid before any attempt", async () => {
    api.mockResolvedValueOnce(NONE);
    render(
      <dl>
        <FeePayment appointmentId="a-1" />
      </dl>,
    );
    expect(await screen.findByText("Not paid, 1,500 XAF owed")).toBeInTheDocument();
  });
});
