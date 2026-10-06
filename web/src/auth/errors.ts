/**
 * What to tell a person when Cognito refuses them.
 *
 * The pool is set to prevent user existence errors, so a wrong email and a
 * wrong password come back the same way and the message must not guess which.
 */

const MESSAGES: Record<string, string> = {
  NotAuthorizedException: "That email and password do not match an account.",
  UserNotFoundException: "That email and password do not match an account.",
  UsernameExistsException: "An account already uses that email. Sign in instead, or reset the password.",
  InvalidPasswordException: "That password does not meet the rules listed.",
  CodeMismatchException: "That code is not right. Check the latest email and try again.",
  ExpiredCodeException: "That code has expired. Ask for a new one.",
  LimitExceededException: "Too many attempts. Wait a few minutes and try again.",
  TooManyRequestsException: "Too many attempts. Wait a few minutes and try again.",
  TooManyFailedAttemptsException: "Too many attempts. Wait a few minutes and try again.",
  InvalidParameterException: "Something in the form is not in the expected format.",
  NetworkError: "Atria could not be reached. Check the connection and try again.",
};

export function messageFor(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  // Cognito says "User is disabled." for an account an administrator deleted
  // (or suspended): it can be restored within 30 days, by the hospital.
  if (name === "NotAuthorizedException" && error instanceof Error && /disabled/i.test(error.message)) {
    return "This account has been closed by the hospital. Contact the front desk: it can be restored within 30 days of closing.";
  }
  // Cognito: "Temporary password has expired and must be reset by an
  // administrator." The password was right but too old; saying it did not
  // match sent people round in circles (user, 2026-10-06).
  if (name === "NotAuthorizedException" && error instanceof Error && /temporary password has expired/i.test(error.message)) {
    return "This temporary password has expired. Ask your administrator to issue a new one; it is valid for 7 days.";
  }
  if (name in MESSAGES) return MESSAGES[name] as string;
  // The library's own wiring ("No AmplifyContext available", a pool not
  // configured) means nothing to the person reading it (audit 2026-10-05).
  if (error instanceof Error && /amplify|user ?pool|not configured/i.test(`${name} ${error.message}`)) {
    return "Signing in is not available right now. Try again in a few minutes.";
  }
  if (error instanceof Error && error.message && !/exception/i.test(error.message)) {
    return error.message;
  }
  return "Something went wrong. Try again.";
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}
