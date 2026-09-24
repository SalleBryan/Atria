import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { cognitoError, renderAt } from "../test/render";
import { PatientSignIn } from "./PatientSignIn";

const auth = vi.hoisted(() => ({ signIn: vi.fn(), signInWithRedirect: vi.fn() }));
const session = vi.hoisted(() => ({ refresh: vi.fn() }));
const config = vi.hoisted(() => ({ configureFor: vi.fn(), setPatientPersistence: vi.fn() }));

vi.mock("aws-amplify/auth", () => auth);
vi.mock("../auth/config", () => config);
vi.mock("../auth/session", () => ({ useSession: () => session }));

async function fillAndSubmit(email = "  amina@example.com ", password = "Douala-Clinic-2026") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

describe("PatientSignIn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is configured for the patient client and waits for both fields", () => {
    renderAt("/sign-in", <PatientSignIn />);
    expect(config.configureFor).toHaveBeenCalledWith("patient");
    expect(screen.getByRole("heading", { name: "Welcome back." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("signs in with the trimmed email and lands on home once the API knows the patient", async () => {
    auth.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    session.refresh.mockResolvedValue({ status: "signed-in" });
    renderAt("/sign-in", <PatientSignIn />);
    await fillAndSubmit();
    expect(auth.signIn).toHaveBeenCalledWith({ username: "amina@example.com", password: "Douala-Clinic-2026" });
    expect(config.setPatientPersistence).toHaveBeenCalledWith(true);
    expect(await screen.findByTestId("landed")).toHaveTextContent("/home");
  });

  it("sends an unconfirmed account to verify its email", async () => {
    auth.signIn.mockRejectedValue(cognitoError("UserNotConfirmedException"));
    renderAt("/sign-in", <PatientSignIn />);
    await fillAndSubmit();
    expect(await screen.findByTestId("landed")).toHaveTextContent('/verify-email {"email":"amina@example.com"}');
  });

  it("does not say whether the email or the password was wrong", async () => {
    auth.signIn.mockRejectedValue(cognitoError("NotAuthorizedException", "Incorrect username or password."));
    renderAt("/sign-in", <PatientSignIn />);
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password do not match an account.");
  });

  it("reports an account the API cannot resolve instead of pretending it signed in", async () => {
    auth.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    session.refresh.mockResolvedValue({ status: "unresolved", message: "Your account could not be loaded." });
    renderAt("/sign-in", <PatientSignIn />);
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account could not be loaded.");
  });

  it("hands Google sign-in to Cognito's hosted page", async () => {
    auth.signInWithRedirect.mockResolvedValue(undefined);
    renderAt("/sign-in", <PatientSignIn />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(auth.signInWithRedirect).toHaveBeenCalledWith({ provider: "Google" });
  });

  it("keeps the session to the tab when the patient unticks keep me signed in", async () => {
    auth.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    session.refresh.mockResolvedValue({ status: "signed-in" });
    renderAt("/sign-in", <PatientSignIn />);
    await userEvent.setup().click(screen.getByLabelText("Keep me signed in"));
    await fillAndSubmit();
    expect(config.setPatientPersistence).toHaveBeenCalledWith(false);
  });
});
