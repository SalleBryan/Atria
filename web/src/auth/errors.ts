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
  if (name in MESSAGES) return MESSAGES[name] as string;
  if (error instanceof Error && error.message && !/exception/i.test(error.message)) {
    return error.message;
  }
  return "Something went wrong. Try again.";
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}
