import { messageFor } from "./errors";

function refused(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("messageFor", () => {
  it("does not say which of email and password was wrong", () => {
    expect(messageFor(refused("NotAuthorizedException", "Incorrect username or password."))).toBe(
      "That email and password do not match an account.",
    );
  });

  it("tells a closed account how to get it back", () => {
    expect(messageFor(refused("NotAuthorizedException", "User is disabled."))).toMatch(/restored within 30 days/);
  });

  it("says when a temporary password has expired, not that it did not match", () => {
    expect(
      messageFor(refused("NotAuthorizedException", "Temporary password has expired and must be reset by an administrator.")),
    ).toBe("This temporary password has expired. Ask your administrator to issue a new one; it is valid for 7 days.");
  });

  it("never shows the sign-in library's own wiring", () => {
    expect(messageFor(new Error("No AmplifyContext available. Make sure Amplify.configure() was called."))).toBe(
      "Signing in is not available right now. Try again in a few minutes.",
    );
  });
});
