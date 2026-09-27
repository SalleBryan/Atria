import { setStaffTrust, trusted, untrust } from "./config";

vi.mock("aws-amplify", () => ({ Amplify: { configure: vi.fn() } }));
vi.mock("aws-amplify/auth/cognito", () => ({ cognitoUserPoolsTokenProvider: { setKeyValueStorage: vi.fn() } }));

describe("Trusting a workstation (FR-ACC-10)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("lasts 12 hours", () => {
    setStaffTrust(true);
    expect(trusted()).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 12 * 3600000 + 1000);
    expect(trusted()).toBe(false);
    vi.useRealTimers();
  });

  it("moves a kept session back into the tab", () => {
    setStaffTrust(true);
    const key = `CognitoIdentityServiceProvider.${import.meta.env.VITE_STAFF_CLIENT_ID}.u.accessToken`;
    localStorage.setItem(key, "token");
    untrust();
    expect(trusted()).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem(key)).toBe("token");
  });
});
