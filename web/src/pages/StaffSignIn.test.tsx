import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { firstSignIn } from "../auth/session";
import { cognitoError, renderAt } from "../test/render";
import { StaffFirstSignIn } from "./StaffFirstSignIn";
import { StaffSignIn } from "./StaffSignIn";

const auth = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), confirmSignIn: vi.fn() }));
const session = vi.hoisted(() => ({ refresh: vi.fn() }));
const config = vi.hoisted(() => ({ configureFor: vi.fn() }));
vi.mock("aws-amplify/auth", () => auth);
vi.mock("../auth/config", () => config);
vi.mock("../auth/session", async (original) => ({
  ...(await original<typeof import("../auth/session")>()),
  useSession: () => session,
}));

const TEMPORARY = "Temporary-Pass-2026";

async function signInAs(email = "ruth@clinic.cm", password = TEMPORARY) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Work email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("StaffSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firstSignIn.clear();
  });

  it("signs in through the staff client, which offers no Google", () => {
    renderAt("/staff/sign-in", <StaffSignIn />);
    expect(config.configureFor).toHaveBeenCalledWith("staff");
    expect(screen.queryByRole("button", { name: /Google/ })).not.toBeInTheDocument();
  });

  it("takes a new account to choose its own password, holding the temporary one in memory", async () => {
    auth.signIn.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" },
    });
    renderAt("/staff/sign-in", <StaffSignIn />);
    await signInAs();
    expect(await screen.findByTestId("landed")).toHaveTextContent("/staff/first-sign-in");
    expect(firstSignIn.peek()).toEqual({ email: "ruth@clinic.cm", password: TEMPORARY });
    // Never through history state, where it would outlive the screen.
    expect(screen.getByTestId("landed")).toHaveTextContent("null");
  });

  it("opens the console for a staff account", async () => {
    auth.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    session.refresh.mockResolvedValue({ status: "signed-in", me: { staffId: "s-1" } });
    renderAt("/staff/sign-in", <StaffSignIn />);
    await signInAs();
    expect(await screen.findByTestId("landed")).toHaveTextContent("/home");
  });

  it("turns a patient account away and ends its session", async () => {
    auth.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    session.refresh.mockResolvedValue({ status: "signed-in", me: { staffId: null } });
    renderAt("/staff/sign-in", <StaffSignIn />);
    await signInAs();
    expect(await screen.findByRole("alert")).toHaveTextContent("That is a patient account.");
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("does not say whether the email or the password was wrong", async () => {
    auth.signIn.mockRejectedValue(cognitoError("NotAuthorizedException"));
    renderAt("/staff/sign-in", <StaffSignIn />);
    await signInAs();
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password do not match an account.");
  });
});

describe("StaffFirstSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firstSignIn.clear();
  });

  async function choose(password: string, confirm = password) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New password"), password);
    await user.type(screen.getByLabelText("Confirm new password"), confirm);
    return user;
  }

  it("starts again from sign-in when the temporary password is gone, as after a reload", () => {
    renderAt("/staff/first-sign-in", <StaffFirstSignIn />);
    expect(screen.getByTestId("landed")).toHaveTextContent("/staff/sign-in");
  });

  it("refuses the temporary password as the new one (ADR 0018)", async () => {
    firstSignIn.hold("ruth@clinic.cm", TEMPORARY);
    renderAt("/staff/first-sign-in", <StaffFirstSignIn />);
    await choose(TEMPORARY);
    const rule = screen.getByText("Not the temporary password you were sent").closest("li");
    expect(rule).not.toHaveClass("rule-met");
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
    expect(auth.confirmSignIn).not.toHaveBeenCalled();
  });

  it("saves a new password that meets every rule, then opens the console", async () => {
    firstSignIn.hold("ruth@clinic.cm", TEMPORARY);
    auth.confirmSignIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    session.refresh.mockResolvedValue({ status: "signed-in", me: { staffId: "s-1" } });
    renderAt("/staff/first-sign-in", <StaffFirstSignIn />);
    const user = await choose("Douala-Front-Desk-9");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(auth.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "Douala-Front-Desk-9" });
    expect(await screen.findByTestId("landed")).toHaveTextContent("/home");
    expect(firstSignIn.peek()).toBeNull();
  });

  it("waits for the two entries to match", async () => {
    firstSignIn.hold("ruth@clinic.cm", TEMPORARY);
    renderAt("/staff/first-sign-in", <StaffFirstSignIn />);
    await choose("Douala-Front-Desk-9", "Douala-Front-Desk-8");
    expect(screen.getByText("The two passwords do not match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
  });
});
