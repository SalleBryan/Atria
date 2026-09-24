import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { cognitoError, renderAt } from "../test/render";
import { CreateAccount } from "./CreateAccount";

const auth = vi.hoisted(() => ({ signUp: vi.fn(), signInWithRedirect: vi.fn() }));
vi.mock("aws-amplify/auth", () => auth);
vi.mock("../auth/config", () => ({ configureFor: vi.fn() }));

async function fill(overrides: Partial<Record<string, string>> = {}) {
  const user = userEvent.setup();
  const values = {
    "Given name": "Amina",
    "Family name": "Ngo",
    "Email address": " amina@example.com ",
    "Mobile number": "6 70 00 00 00",
    Password: "Douala-Clinic-2026",
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    if (value) await user.type(screen.getByLabelText(label), value);
  }
  await user.click(screen.getByLabelText("I agree to the Atria terms and privacy notice."));
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("CreateAccount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs up with the attributes the post-confirmation trigger reads", async () => {
    auth.signUp.mockResolvedValue({ isSignUpComplete: false, nextStep: { signUpStep: "CONFIRM_SIGN_UP" } });
    renderAt("/create-account", <CreateAccount />);
    await fill();
    expect(auth.signUp).toHaveBeenCalledWith({
      username: "amina@example.com",
      password: "Douala-Clinic-2026",
      options: {
        autoSignIn: true,
        userAttributes: {
          email: "amina@example.com",
          phone_number: "+237670000000",
          given_name: "Amina",
          family_name: "Ngo",
        },
      },
    });
    expect(await screen.findByTestId("landed")).toHaveTextContent('/verify-email {"email":"amina@example.com"}');
  });

  it("refuses a number that is not a Cameroonian mobile, before asking Cognito", async () => {
    renderAt("/create-account", <CreateAccount />);
    await fill({ "Mobile number": "+233 24 555 0142" });
    expect(screen.getByText(/Enter a Cameroonian mobile number/)).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("names the password rules a weak password misses", async () => {
    renderAt("/create-account", <CreateAccount />);
    await fill({ Password: "short" });
    expect(screen.getByText(/at least 12 characters, upper and lower case letters, a number/)).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("puts a taken email against the email field", async () => {
    auth.signUp.mockRejectedValue(cognitoError("UsernameExistsException"));
    renderAt("/create-account", <CreateAccount />);
    await fill();
    expect(await screen.findByText(/An account already uses that email/)).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("aria-invalid", "true");
  });

  it("needs the terms agreed", async () => {
    renderAt("/create-account", <CreateAccount />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Agree to the terms to create an account.")).toBeInTheDocument();
  });
});
