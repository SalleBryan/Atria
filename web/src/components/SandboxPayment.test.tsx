import { fireEvent, render, screen } from "@testing-library/react";

import { FeePayment, PayFee } from "./SandboxPayment";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api }));

const NONE = { appointmentId: "a-1", sandbox: true, status: "NONE", paid: false, amount: 1500, currency: "XAF" };
const STARTED = { ...NONE, status: "CREATED", attemptId: "x", checkoutUrl: "https://sandbox.fapshi.com/checkout/t" };
const PAID = { ...STARTED, status: "SUCCESSFUL", paid: true };

describe("PayFee, the patient's side", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers to pay exactly the visit's fee, as a test payment", async () => {
    api.mockResolvedValueOnce(NONE);
    render(<PayFee appointmentId="a-1" />);
    expect(await screen.findByRole("button", { name: "Pay 1,500 XAF now" })).toBeInTheDocument();
    expect(screen.getByText(/No real money moves/)).toBeInTheDocument();
  });

  it("starts a checkout with a fresh attempt, then links to Fapshi's test page", async () => {
    api.mockResolvedValueOnce(NONE).mockResolvedValueOnce(STARTED);
    render(<PayFee appointmentId="a-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Pay 1,500 XAF now" }));
    expect(await screen.findByRole("link", { name: "Open the test checkout" })).toHaveAttribute("href", STARTED.checkoutUrl);
    const [path, init] = api.mock.calls[1]!;
    expect(path).toBe("/appointments/a-1/payment");
    expect(init.method).toBe("POST");
    expect(init.json.attemptId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("says the fee is paid once the check confirms it", async () => {
    api.mockResolvedValueOnce(STARTED).mockResolvedValueOnce(PAID);
    render(<PayFee appointmentId="a-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "I have paid, check" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Fee paid, 1,500 XAF");
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
    expect(await screen.findByText("Paid in full, 1,500 XAF")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("shows what is owed and checks again on request", async () => {
    api.mockResolvedValueOnce(STARTED).mockResolvedValueOnce(PAID);
    render(
      <dl>
        <FeePayment appointmentId="a-1" />
      </dl>,
    );
    expect(await screen.findByText("Started, not confirmed yet (1,500 XAF)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Paid in full, 1,500 XAF")).toBeInTheDocument();
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
