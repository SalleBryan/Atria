import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { cognitoError, renderAt } from "../test/render";
import { ResetPassword } from "./ResetPassword";

const auth = vi.hoisted(() => ({ resetPassword: vi.fn(), confirmResetPassword: vi.fn() }));
const config = vi.hoisted(() => ({ configureFor: vi.fn() }));
vi.mock("aws-amplify/auth", () => auth);
vi.mock("../auth/config", () => config);

async function requestCode(email = "amina@example.com") {
  auth.resetPassword.mockResolvedValue({ nextStep: { resetPasswordStep: "CONFIRM_RESET_PASSWORD_WITH_CODE" } });
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Email address"));
  await user.type(screen.getByLabelText("Email address"), email);
  await user.click(screen.getByRole("button", { name: "Send reset code" }));
  await screen.findByRole("heading", { name: "Choose a new password." });
  return user;
}

async function enterNewPassword(user: ReturnType<typeof userEvent.setup>, password: string, confirm = password) {
  fireEvent.paste(screen.getByLabelText("Digit 1 of 6"), { clipboardData: { getData: () => "123456" } });
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
}

describe("ResetPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("carries the email over from the sign-in screen", () => {
    renderAt("/reset-password", <ResetPassword />, { email: "amina@example.com" });
    expect(screen.getByLabelText("Email address")).toHaveValue("amina@example.com");
    expect(config.configureFor).toHaveBeenCalledWith("patient");
  });

  it("moves on without saying whether the address has an account", async () => {
    renderAt("/reset-password", <ResetPassword />);
    await requestCode("nobody@example.com");
    expect(auth.resetPassword).toHaveBeenCalledWith({ username: "nobody@example.com" });
    expect(screen.getByText(/If/)).toHaveTextContent("If nobody@example.com has an Atria account");
  });

  it("saves only when the code is whole, the rules are met and both entries match", async () => {
    auth.confirmResetPassword.mockResolvedValue(undefined);
    renderAt("/reset-password", <ResetPassword />);
    const user = await requestCode();
    await enterNewPassword(user, "Douala-Clinic-2026", "Douala-Clinic-2025");
    expect(screen.getByText("The two passwords do not match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save new password" })).toBeDisabled();

    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("Confirm new password"), "Douala-Clinic-2026");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(auth.confirmResetPassword).toHaveBeenCalledWith({
      username: "amina@example.com",
      confirmationCode: "123456",
      newPassword: "Douala-Clinic-2026",
    });
    expect(await screen.findByTestId("landed")).toHaveTextContent("/sign-in");
    expect(screen.getByTestId("landed")).toHaveTextContent("Password changed.");
  });

  it("keeps a weak password from being sent", async () => {
    renderAt("/reset-password", <ResetPassword />);
    const user = await requestCode();
    await enterNewPassword(user, "weakpassword");
    expect(screen.getByRole("button", { name: "Save new password" })).toBeDisabled();
    expect(screen.getByText(/A number/).closest("li")).not.toHaveClass("rule-met");
  });

  it("explains an expired code", async () => {
    auth.confirmResetPassword.mockRejectedValue(cognitoError("ExpiredCodeException"));
    renderAt("/reset-password", <ResetPassword />);
    const user = await requestCode();
    await enterNewPassword(user, "Douala-Clinic-2026");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code has expired.");
  });

  it("sends staff back to the console sign-in, through the staff client", async () => {
    auth.confirmResetPassword.mockResolvedValue(undefined);
    renderAt("/staff/reset-password", <ResetPassword audience="staff" />);
    expect(config.configureFor).toHaveBeenCalledWith("staff");
    expect(screen.queryByText(/Signed up with Google/)).not.toBeInTheDocument();
    const user = await requestCode("ruth@clinic.example");
    await enterNewPassword(user, "Douala-Clinic-2026");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/staff/sign-in");
  });
});
