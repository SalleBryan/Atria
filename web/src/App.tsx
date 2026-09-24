import { Navigate, Route, Routes } from "react-router-dom";

import { useSession } from "./auth/session";
import { AuthCallback } from "./pages/AuthCallback";
import { CreateAccount } from "./pages/CreateAccount";
import { Home } from "./pages/Home";
import { VerifyEmail } from "./pages/VerifyEmail";
import { PatientSignIn } from "./pages/PatientSignIn";
import { ResetPassword } from "./pages/ResetPassword";
import { StaffFirstSignIn } from "./pages/StaffFirstSignIn";
import { StaffSignIn } from "./pages/StaffSignIn";

function Landing() {
  const { state } = useSession();
  if (state.status === "loading") return null;
  return <Navigate to={state.status === "signed-in" ? "/home" : "/sign-in"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/sign-in" element={<PatientSignIn />} />
      <Route path="/create-account" element={<CreateAccount />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/staff/sign-in" element={<StaffSignIn />} />
      <Route path="/staff/first-sign-in" element={<StaffFirstSignIn />} />
      <Route path="/staff/reset-password" element={<ResetPassword audience="staff" />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/home" element={<Home />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
