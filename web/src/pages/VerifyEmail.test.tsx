import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { cognitoError, renderAt } from "../test/render";
import { VerifyEmail } from "./VerifyEmail";

const auth = vi.hoisted(() => ({ confirmSignUp: vi.fn(), autoSignIn: vi.fn(), resendSignUpCode: vi.fn() }));
const session = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("aws-amplify/auth", () => auth);
vi.mock("../auth/config", () => ({ configureFor: vi.fn() }));
vi.mock("../auth/session", () => ({ useSession: () => session }));

const EMAIL = { email: "amina@example.com" };

function pasteCode(code: string) {
  fireEvent.paste(screen.getByLabelText("Digit 1 of 6"), { clipboardData: { getData: () => code } });
}

describe("VerifyEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends someone with no pending sign-up back to sign in", () => {
    renderAt("/verify-email", <VerifyEmail />);
    expect(screen.getByTestId("landed")).toHaveTextContent("/sign-in");
  });

  it("fills every box from a pasted code and only then allows verifying", () => {
    renderAt("/verify-email", <VerifyEmail />, EMAIL);
    const verify = screen.getByRole("button", { name: "Verify and continue" });
    expect(verify).toBeDisabled();
    pasteCode("41 92 85");
    expect(screen.getByLabelText("Digit 6 of 6")).toHaveValue("5");
    expect(verify).toBeEnabled();
  });

  it("keeps later digits in place when one in the middle is cleared", async () => {
    renderAt("/verify-email", <VerifyEmail />, EMAIL);
    pasteCode("419285");
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Digit 3 of 6"));
    await user.keyboard("{Backspace}");
    expect(screen.getByLabelText("Digit 3 of 6")).toHaveValue("");
    expect(screen.getByLabelText("Digit 4 of 6")).toHaveValue("2");
    expect(screen.getByRole("button", { name: "Verify and continue" })).toBeDisabled();
  });

  it("signs a fresh sign-up straight in once the code is accepted", async () => {
    auth.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: "COMPLETE_AUTO_SIGN_IN" } });
    auth.autoSignIn.mockResolvedValue({ isSignedIn: true });
    session.refresh.mockResolvedValue({ status: "signed-in" });
    renderAt("/verify-email", <VerifyEmail />, EMAIL);
    pasteCode("419285");
    await userEvent.setup().click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(auth.confirmSignUp).toHaveBeenCalledWith({ username: "amina@example.com", confirmationCode: "419285" });
    expect(await screen.findByTestId("landed")).toHaveTextContent("/home");
  });

  it("sends a confirmed account with no sign-up session to sign in", async () => {
    auth.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: "DONE" } });
    renderAt("/verify-email", <VerifyEmail />, EMAIL);
    pasteCode("419285");
    await userEvent.setup().click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("Email confirmed. Sign in to continue.");
  });

  it("clears the boxes and explains a wrong code", async () => {
    auth.confirmSignUp.mockRejectedValue(cognitoError("CodeMismatchException"));
    renderAt("/verify-email", <VerifyEmail />, EMAIL);
    pasteCode("000000");
    await userEvent.setup().click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right.");
    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("");
  });

  it("offers a new code only after the countdown", async () => {
    vi.useFakeTimers();
    try {
      renderAt("/verify-email", <VerifyEmail />, EMAIL);
      expect(screen.getByRole("button", { name: "Resend in 1:00" })).toBeDisabled();
      for (let second = 0; second < 60; second += 1) {
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
      }
      expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
