import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Me } from "../api/client";
import { renderAt } from "../test/render";
import { grouped, StaffAuthenticatorCode, StaffAuthenticatorSetup } from "./StaffAuthenticator";
import { StaffSignIn } from "./StaffSignIn";

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  confirmSignIn: vi.fn(),
  setUpTOTP: vi.fn(),
  verifyTOTPSetup: vi.fn(),
  updateMFAPreference: vi.fn(),
  fetchAuthSession: vi.fn(),
}));
const session = vi.hoisted(() => ({ refresh: vi.fn(), signOut: vi.fn() }));
vi.mock("aws-amplify/auth", () => auth);
vi.mock("../auth/config", () => ({ configureFor: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") } }));
vi.mock("../auth/session", async (original) => ({
  ...(await original<typeof import("../auth/session")>()),
  useSession: () => session,
}));

const ADMIN = { email: "admin@rhb.cm", givenName: "Esther", familyName: "Ndive", roles: ["TENANT_ADMIN"] } as unknown as Me;
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

async function typeCode(code = "123456") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Digit 1 of 6"), code);
  return user;
}

describe("An administrator's authenticator (FR-ACC-11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.setUpTOTP.mockResolvedValue({
      sharedSecret: SECRET,
      getSetupUri: (issuer: string, account: string) => new URL(`otpauth://totp/${issuer}:${account}?secret=${SECRET}`),
    });
  });

  it("sends a challenged sign-in to the code screen", async () => {
    auth.signIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_TOTP_CODE" } });
    renderAt("/staff/sign-in", <StaffSignIn />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Work email"), "admin@rhb.cm");
    await user.type(screen.getByLabelText("Password"), "Some-Password-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent('/staff/authenticator {"email":"admin@rhb.cm"}');
  });

  it("confirms the code and opens the console", async () => {
    auth.confirmSignIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    session.refresh.mockResolvedValue({ status: "signed-in" });
    renderAt("/staff/authenticator", <StaffAuthenticatorCode />, { email: "admin@rhb.cm" });
    const user = await typeCode();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(auth.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "123456" });
    expect(await screen.findByTestId("landed")).toHaveTextContent("/console");
  });

  it("has nothing to continue after a reload", async () => {
    renderAt("/staff/authenticator", <StaffAuthenticatorCode />);
    expect(await screen.findByTestId("landed")).toHaveTextContent("/staff/sign-in");
  });

  it("sets one up: the QR code and the key, then a code turns it on", async () => {
    session.refresh.mockResolvedValue({ status: "signed-in" });
    renderAt("/console", <StaffAuthenticatorSetup me={ADMIN} />);
    expect(await screen.findByAltText("QR code for your authenticator app")).toBeInTheDocument();
    expect(screen.getByText(grouped(SECRET))).toBeInTheDocument();
    const user = await typeCode("654321");
    await user.click(screen.getByRole("button", { name: "Turn on and continue" }));
    await waitFor(() => expect(session.refresh).toHaveBeenCalledWith("staff"));
    expect(auth.verifyTOTPSetup).toHaveBeenCalledWith({ code: "654321" });
    expect(auth.updateMFAPreference).toHaveBeenCalledWith({ totp: "PREFERRED" });
    // The refreshed token is the one that carries the authenticator.
    expect(auth.fetchAuthSession).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("says so when the code is wrong, and keeps the setup", async () => {
    auth.verifyTOTPSetup.mockRejectedValue(Object.assign(new Error("Code mismatch"), { name: "CodeMismatchException" }));
    renderAt("/console", <StaffAuthenticatorSetup me={ADMIN} />);
    await screen.findByAltText("QR code for your authenticator app");
    const user = await typeCode();
    await user.click(screen.getByRole("button", { name: "Turn on and continue" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(auth.updateMFAPreference).not.toHaveBeenCalled();
  });

  it("groups the key in fours", () => {
    expect(grouped("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});
