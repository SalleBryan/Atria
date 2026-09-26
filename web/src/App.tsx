import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useSession } from "./auth/session";
import { Waiting } from "./components/Waiting";
import { AuthCallback } from "./pages/AuthCallback";
import { CreateAccount } from "./pages/CreateAccount";
import { Landing } from "./pages/Landing";
import { VerifyEmail } from "./pages/VerifyEmail";
import { PatientSignIn } from "./pages/PatientSignIn";
import { ResetPassword } from "./pages/ResetPassword";
import { StaffFirstSignIn } from "./pages/StaffFirstSignIn";
import { StaffSignIn } from "./pages/StaffSignIn";
import { patientRoutes } from "./patient/routes";
import { staffRoutes } from "./staff/routes";

/** Where a signed-in person belongs: the staff console or the patient app. */
const home = (audience: string) => (audience === "staff" ? "/console" : "/home");

/**
 * The sign-in, sign-up and reset pages are for people who are signed out. A
 * signed-in person who opens one, by typing its address say, is taken to
 * their own dashboard instead of being asked to sign in again.
 */
function SignedOutOnly({ children }: { children: ReactElement }) {
  const { state } = useSession();
  if (state.status === "loading") return <Waiting />;
  if (state.status === "signed-in") return <Navigate to={home(state.audience)} replace />;
  return children;
}

/** The front page for anyone signed out; a signed-in person goes straight to their dashboard. */
function Front() {
  const { state } = useSession();
  if (state.status === "loading") return <Waiting />;
  if (state.status !== "signed-in") return <Landing />;
  return <Navigate to={home(state.audience)} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Front />} />
      <Route path="/sign-in" element={<SignedOutOnly><PatientSignIn /></SignedOutOnly>} />
      <Route path="/create-account" element={<SignedOutOnly><CreateAccount /></SignedOutOnly>} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/reset-password" element={<SignedOutOnly><ResetPassword /></SignedOutOnly>} />
      <Route path="/staff/sign-in" element={<SignedOutOnly><StaffSignIn /></SignedOutOnly>} />
      <Route path="/staff/first-sign-in" element={<StaffFirstSignIn />} />
      <Route path="/staff/reset-password" element={<SignedOutOnly><ResetPassword audience="staff" /></SignedOutOnly>} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      {staffRoutes}
      {patientRoutes}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
