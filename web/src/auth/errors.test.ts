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
});
